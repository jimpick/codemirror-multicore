const budo = require('budo')
const express = require('express')
const expressWebSocket = require('express-ws')
const websocketStream = require('websocket-stream/stream')
const pump = require('pump')
const through2 = require('through2')
const ram = require('random-access-memory')
const toBuffer = require('to-buffer')
const hypercore = require('hypercore')
const sheetify = require('sheetify')
const brfs = require('brfs')
const prettyHash = require('pretty-hash')
const Multicore = require('./multicore')

require('events').prototype._maxListeners = 100

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
          console.log('pipe finished', err)
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


