var mosca = require("mosca");
var server = new mosca.Server({
  http: {
    port: 3000,
    bundle: true,
    static: './'
  }
});
server.on('ready', function setup() {
  console.log('Mosca server is up and running')
});
