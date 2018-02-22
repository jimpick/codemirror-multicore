const browserify = require('browserify-middleware')
const express = require('express')
const expressWebSocket = require('express-ws')
const websocketStream = require('websocket-stream/stream')
const pump = require('pump')
const through2 = require('through2')
// const hypercore = require('hypercore')
const ram = require('random-access-memory')
const toBuffer = require('to-buffer')
const hypercore = require('hypercore')
const Multicore = require('./script/multicore')

require('events').prototype._maxListeners = 100

const app = express()

app.use('/js', browserify(__dirname + '/script', {
  transform: ['sheetify']
}))
app.use(express.static(__dirname + '/public'))

expressWebSocket(app, null, {
  perMessageDeflate: false
})

const multicores = {}

app.ws('/archiver/:key', (ws, req) => {
  const key = req.params.key
  console.log('Websocket initiated for', key)
  let multicore
  if (multicores[key]) {
    multicore = multicores[key]
  } else {
    multicore = new Multicore(ram, {key})
    multicores[key] = multicore
    const ar = multicore.archiver
    ar.on('add', feed => {
      console.log('archive add', feed.key.toString('hex'))
      multicore.replicateFeed(feed)
    })
    ar.on('sync', () => {
      console.log('archive sync')
    })
    ar.on('ready', () => {
      console.log('archive ready', ar.changes.length)
      ar.changes.on('append', () => {
        console.log('archive changes append', ar.changes.length)
      })
      ar.changes.on('sync', () => {
        console.log('archive changes sync', ar.changes.length)
      })
      // Join swarm
      const sw = multicore.joinSwarm()
      sw.on('connection', (peer, type) => {
        /*
        try {
          if (!peer.remoteUserData) throw new Error('No user data')
          const userData = JSON.parse(peer.remoteUserData.toString())
          if (userData.key) {
            console.log(`Connect ${userData.name} ${userData.key}`)
            const dk = hypercore.discoveryKey(toBuffer(userData.key, 'hex'))
            multicore.archiver.add(dk)
            multicore.announceActor(userData.name, userData.key)
          }
        } catch (e) {
          console.log(`Connection with no or invalid user data`, e)
          // console.error('Error parsing JSON', e)
        }
        */
      })
    })
  }
  const ar = multicore.archiver
  ar.ready(() => {
    const stream = websocketStream(ws)
    pump(
      stream,
      through2(function (chunk, enc, cb) {
        // console.log('From web', chunk)
        this.push(chunk)
        cb()
      }),
      ar.replicate({encrypt: false}),
      through2(function (chunk, enc, cb) {
        // console.log('To web', chunk)
        this.push(chunk)
        cb()
      }),
      stream
    )
    multicore.replicateFeed(ar.changes)
  })
})

const listener = app.listen(process.env.PORT, () => {
  console.log('Listening on port', listener.address().port)
})

