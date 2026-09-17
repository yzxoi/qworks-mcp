"""Small Python control program executed only in the adapter's private kernel.

The worker runs in its own process group. Its receipt and logs survive a client
disconnect or control-kernel shutdown. No third-party Python package is needed.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import signal
import shutil
import stat
import subprocess
import sys
import tempfile
import time


def _atomic(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value), encoding='utf-8')
    os.chmod(str(temporary), 0o600)
    os.replace(str(temporary), str(path))


def _process(pid):
    try:
        text = Path('/proc/{}/stat'.format(pid)).read_text()
        fields = text[text.rfind(')') + 2:].split()
        return {'state': fields[0], 'started': fields[19]}
    except (FileNotFoundError, ProcessLookupError):
        return None


_WORKER = r'''
import json, os, subprocess, sys, time
from pathlib import Path
directory = Path(sys.argv[1])
request = json.loads((directory / 'request.json').read_text())
environment = os.environ.copy()
environment.update(request.get('env', {}))
try:
    process = subprocess.Popen(['/bin/bash', '-lc', request['command']],
        cwd=request.get('cwd') or None, env=environment, stdin=subprocess.DEVNULL)
    code = process.wait()
    result = {'exit_code': code, 'finished_at': time.time()}
except BaseException as error:
    print(type(error).__name__ + ': command could not be started', flush=True)
    result = {'exit_code': 127, 'finished_at': time.time()}
temporary = directory / 'exit.tmp'
temporary.write_text(json.dumps(result))
os.replace(str(temporary), str(directory / 'exit.json'))
'''


def _job(request):
    if not sys.platform.startswith('linux'):
        raise RuntimeError('Background jobs require a Linux instance')
    root = Path(tempfile.gettempdir()) / ('qworks-mcp-' + str(os.getuid()))
    directory = root / request['session_id'] / request['job_id']
    # Never traverse a pre-existing symlink in the private remote spool.
    for path in [root, root / request['session_id'], directory]:
        if not path.exists():
            try:
                path.mkdir(mode=0o700)
            except FileExistsError:
                pass
        info = path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
            raise RuntimeError('Invalid job spool directory')
    receipt_path = directory / 'receipt.json'
    receipt = json.loads(receipt_path.read_text()) if receipt_path.exists() else None
    operation = request['op']
    if operation == 'start':
        payload = {key: request.get(key) for key in ['command', 'cwd', 'env']}
        fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
        if receipt:
            if receipt['fingerprint'] != fingerprint:
                raise ValueError('Job ID already belongs to a different command')
        else:
            # An incomplete claim means a previous launch may have happened.
            # Never replay an uncertain command automatically.
            claim = directory / 'claim'
            descriptor = os.open(str(claim), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            os.close(descriptor)
            _atomic(directory / 'request.json', payload)
            (directory / 'worker.py').write_text(_WORKER)
            os.chmod(str(directory / 'worker.py'), 0o600)
            with (directory / 'stdout').open('ab', buffering=0) as output:
                child = subprocess.Popen([sys.executable, str(directory / 'worker.py'), str(directory)],
                    stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT,
                    start_new_session=True, close_fds=True)
            identity = _process(child.pid)
            receipt = {'pid': child.pid, 'started': identity['started'] if identity else None,
                       'fingerprint': fingerprint, 'created_at': time.time()}
            _atomic(receipt_path, receipt)
    if not receipt:
        return {'state': 'unknown', 'finished': False, 'output': '', 'next_cursor': request.get('cursor', 0),
                'message': 'No launch receipt found; the command has not been replayed.'}
    current = _process(receipt['pid'])
    alive = current is not None and current['state'] != 'Z' and current['started'] == receipt['started']
    if operation == 'forget':
        if alive:
            raise RuntimeError('Cannot forget a running job; cancel it first')
        shutil.rmtree(str(directory))
        return {'forgotten': True}
    if operation == 'cancel' and alive:
        command_line = Path('/proc/{}/cmdline'.format(receipt['pid'])).read_bytes()
        if str(directory).encode() not in command_line or os.getpgid(receipt['pid']) != receipt['pid']:
            raise RuntimeError('Process ownership check failed')
        sig = signal.SIGKILL if request.get('force') else signal.SIGTERM
        _atomic(directory / 'cancel.json', {'signal': int(sig), 'requested_at': time.time()})
        os.killpg(receipt['pid'], sig)
    result = json.loads((directory / 'exit.json').read_text()) if (directory / 'exit.json').exists() else None
    cancelled = json.loads((directory / 'cancel.json').read_text()) if (directory / 'cancel.json').exists() else None
    state = 'finished' if result else ('cancel_requested' if alive and cancelled else 'running' if alive else 'cancelled' if cancelled else 'lost')
    cursor = request.get('cursor', 0)
    output_path = directory / 'stdout'
    size = output_path.stat().st_size if output_path.exists() else 0
    if cursor > size:
        raise ValueError('Output cursor exceeds log size')
    chunk = b''
    if output_path.exists():
        with output_path.open('rb') as output:
            output.seek(cursor)
            chunk = output.read(request.get('max_bytes', 65536))
    return {'state': state, 'finished': state in ['finished', 'cancelled', 'lost'],
            'exit_code': result['exit_code'] if result else (128 + cancelled['signal'] if state == 'cancelled' else None),
            'output': chunk.decode('utf-8', errors='replace'), 'cursor': cursor,
            'next_cursor': cursor + len(chunk), 'has_more': cursor + len(chunk) < size,
            'log_bytes': size, 'created_at': receipt['created_at']}


try:
    _answer = _job(_request)
except Exception as _error:
    _answer = {'error': type(_error).__name__, 'message': str(_error)}
print(_marker + base64.b64encode(json.dumps(_answer).encode()).decode(), flush=True)
