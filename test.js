var hyperdrive = require('hyperdrive')
var swarm = require('hyperdiscovery')

var archive = hyperdrive('./database')
archive.writeFile('/hello.txt', 'world', function (err) {
  if (err) throw err
  archive.readdir('/', function (err, list) {
    if (err) throw err
    console.log(list) // prints ['hello.txt']
    archive.readFile('/hello.txt', 'utf-8', function (err, data) {
      if (err) throw err
      console.log(data) // prints 'world'
    })
  })
})
archive.ready(() => {
	console.log('Key:', archive.key.toString('hex'))
	var sw = swarm(archive)
	sw.on('connection', function (peer, type) {
	  console.log('got', peer, type) 
	  console.log('connected to', sw.connections.length, 'peers')
	  peer.on('close', function () {
	    console.log('peer disconnected')
	  })
	})
})
