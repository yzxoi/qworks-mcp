// Fail the offline smoke test if the adapter attempts an outbound connection.
require('node:net').Socket.prototype.connect = function () {
  throw new Error('Outbound network is disabled in this test');
};
globalThis.fetch = async function () {
  throw new Error('Outbound network is disabled in this test');
};
