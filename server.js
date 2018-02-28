const budo = require('budo')
const express = require('express')
const expressWebSocket = require('express-ws')
const websocketStream = require('websocket-stream/stream')
const pump = require('pump')
const through2 = require('through2')
const ram = require('random-access-memory')
const hypercore = require('hypercore')
const hyperdiscovery = require('hyperdiscovery')
const sheetify = require('sheetify')
const brfs = require('brfs')
const prettyHash = require('pretty-hash')
const Multicore = require('./multicore')

require('events').prototype._maxListeners = 100

// Run a cloud peer using pixelpusherd
// https://github.com/automerge/pixelpusherd

const defaultCloudPeers = [
  'db26829a97db4a3f30b189357fab79c10c543c8e0a65a9d594eb3cb15e8aba1d'
]

const router = express.Router()

router.get('/page/:key', (req, res, next) => {
  req.url = '/index.html'
  next()
})

const multicores = {}

function attachWebsocket (server) {
  console.log('Attaching websocket')
  expressWebSocket(router, server, {
    perMessageDeflate: false
  })

  router.ws('/archiver/:key', (ws, req) => {
    const archiverKey = req.params.key
    console.log('Websocket initiated for', archiverKey)
    let multicore
    if (multicores[archiverKey]) {
      multicore = multicores[archiverKey]
    } else {
      multicore = new Multicore(ram, {key: archiverKey})
      multicores[archiverKey] = multicore
      const ar = multicore.archiver
      ar.on('add', feed => {
        console.log('archive add', feed.key.toString('hex'))
        multicore.replicateFeed(feed)
        feed.on('append', () => {
          console.log('append', prettyHash(feed.key), feed.length)
        })
        feed.on('sync', () => {
          console.log('sync', prettyHash(feed.key), feed.length)
        })
      })
      ar.on('add-archive', (metadata, content) => {
        console.log(
          'archive add-archive',
          metadata.key.toString('hex'),
          content.key.toString('hex')
        )
        content.on('append', () => {
          console.log(
            'append content',
            prettyHash(content.key),
            content.length
          )
        })
        content.on('sync', () => {
          console.log(
            'sync content',
            prettyHash(content.key),
            content.length
          )
        })
      })
      ar.on('sync', feed => {
        console.log('archive fully synced', prettyHash(feed.key))
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
        sw.on('connection', (peer, info) => {
          console.log('Swarm connection', info)
        })
        // Connect cloud peers
        connectCloudPeers(archiverKey)
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
        stream,
        err => {
          console.log('pipe finished', err.message)
        }
      )
      console.log(
        'Changes feed dk:',
        ar.changes.discoveryKey.toString('hex')
      )
      multicore.replicateFeed(ar.changes)
    })
  })
}

function connectCloudPeers (archiverKey) {
  const cloudPeers = defaultCloudPeers.reduce((acc, key) => {
    acc[key] = {}
    return acc
  }, {})
  Object.keys(cloudPeers).forEach(key => {
    console.log('Cloud peer connecting...', key)
    const feed = hypercore(ram, key)
    feed.ready(() => {
      // FIXME: We should encrypt this
      const userData = JSON.stringify({key: archiverKey})
      const sw = hyperdiscovery(feed, {
        stream: () => feed.replicate({userData})
      })
      sw.on('connection', peer => {
        let name
        try {
          if (peer.remoteUserData) {
            const json = JSON.parse(peer.remoteUserData.toString())
            name = json.name
            console.log('Connected to cloud peer', key, name)
          }
        } catch (e) {
          console.log('Cloud peer JSON parse error')
        }
        peer.on('error', err => {
          console.log('Cloud peer connection error', key, err.message)
        })
        peer.on('close', err => {
          console.log('Cloud peer connection closed', key, err.message)
        })
      })
    })
  })
}

const port = process.env.PORT || 5000
const devServer = budo('index.js', {
  port,
  browserify: {
    transform: [ brfs, sheetify ]
  },
  middleware: [
    router
  ]
})
devServer.on('connect', event => {
  console.log('Listening on', event.uri)
  attachWebsocket(event.server)
})
