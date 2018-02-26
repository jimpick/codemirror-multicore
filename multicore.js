const {EventEmitter} = require('events')
const Archiver = require('hypercore-archiver')
var protocol = require('hypercore-protocol')
const hypercore = require('hypercore')
const hyperdrive = require('hyperdrive')
const crypto = require('hypercore/lib/crypto')
const sodium = require('sodium-universal')
const thunky = require('thunky')
const toBuffer = require('to-buffer')
const prettyHash = require('pretty-hash')
const swarm = require('./multicore-swarm')

// Monkey-patch hypercore-archiver so we can create a Hypercore
// directly in the archive

Archiver.prototype.createFeed = function (key, opts) {
  const self = this
  opts = opts || {}
  if (!key) {
    // create key pair
    const keyPair = crypto.keyPair()
    key = keyPair.publicKey
    opts.secretKey = keyPair.secretKey
  }
  const dk = hypercore.discoveryKey(key).toString('hex')

  if (this.feeds[dk]) {
    return this.feeds[dk]
  }
  if (this.archives[dk]) {
    return this.archives[dk]
  }

  opts.sparse = this.sparse
  const feed = hypercore(storage(key), key, opts)
  this.feeds[dk] = feed

  this.changes.append({type: 'add', key: key.toString('hex')})

  return feed

  // copied from hypercore-archiver.prototype._add()
  function storage (key) {
    var dk = hypercore.discoveryKey(key).toString('hex')
    var prefix = dk.slice(0, 2) + '/' + dk.slice(2, 4) + '/' + dk.slice(4) + '/'

    return function (name) {
      return self.storage.feeds(prefix + name)
    }
  }
}

Archiver.prototype.createArchive = function (key, opts) {
  const self = this
  const metadataOpts = opts || {}
  if (!key) {
    // create key pair
    const keyPair = crypto.keyPair()
    key = keyPair.publicKey
    metadataOpts.secretKey = keyPair.secretKey
  }
  const dk = hypercore.discoveryKey(key).toString('hex')

  if (this.feeds[dk]) {
    return this.feeds[dk]
  }
  if (this.archives[dk]) {
    return this.archives[dk]
  }

  // Create two hypercores for archive using hypercore-archiver
  // file layout
  const metadata = hypercore(storage(key), key, metadataOpts)

  /*
  const contentKeys = contentKeyPair(metadataOpts.secretKey)
  const contentOpts = {
    secretKey: contentKeys.secretKey,
    storeSecretKey: false
  }
  const content = hypercore(
    storage(contentKeys.publicKey),
    contentKeys.publicKey,
    contentOpts
  )
  */

  this.archives[dk] = {
    metadataSynced: true,
    metadata,
    contentSynced: false
  }

  const archive = this.getHyperdrive(dk)
  archive.ready(() => {
    this.archives[dk].contentSynced = true
    this.archives[dk].content = archive.content

    this.changes.append({type: 'add', key: key.toString('hex')})
  })

  return archive

  // copied from hypercore-archiver.prototype._add()
  function storage (key) {
    var dk = hypercore.discoveryKey(key).toString('hex')
    var prefix = dk.slice(0, 2) + '/' + dk.slice(2, 4) + '/' + dk.slice(4) + '/'

    return function (name) {
      return self.storage.feeds(prefix + name)
    }
  }
}

Archiver.prototype.getHyperdrive = function (dk) {
  if (!this.archives[dk]) return null
  const self = this
  const {metadata} = this.archives[dk]
  const options = {
    metadata,
    sparse: true,
    sparseMetadata: true
  }
  const contentKeys = contentKeyPair(metadata.secretKey)
  const contentDk = hypercore.discoveryKey(contentKeys.publicKey)
                      .toString('hex')
  archive = new hyperdrive(storage, metadata.key, options)
  return archive

  function storage (name) {
    console.log('Jim getHyperdrive', name)
    const match = name.match(/^content\/(.*)$/)
    let path
    if (match) {
      path = contentDk.slice(0, 2) + '/' + contentDk.slice(2, 4) + '/'
        + contentDk.slice(4) + '/' + match[1]
    } else {
      throw new Error('Unexpected storage key')
    }
    console.log('Jim getHyperdrive2', path)
    return self.storage.feeds(path)
  }
}

// Override so we can pass userData
Archiver.prototype.replicate = function (opts) {
  if (!opts) opts = {}

  if (opts.discoveryKey) opts.discoveryKey = toBuffer(opts.discoveryKey, 'hex')
  if (opts.key) opts.discoveryKey = hypercore.discoveryKey(toBuffer(opts.key, 'hex'))

  const protocolOpts = {
    live: true,
    id: this.changes.id,
    encrypt: opts.encrypt
  }
  if (opts.userData) {
    protocolOpts.userData = opts.userData
  }
  var stream = protocol(protocolOpts)
  var self = this

  stream.on('feed', add)
  if (opts.channel || opts.discoveryKey) add(opts.channel || opts.discoveryKey)

  this.on('replicateFeed', feed => {
    add(feed.discoveryKey)
  })

  function add (dk) {
    self.ready(function (err) {
      // console.log('Add dk', dk.toString('hex'))
      if (err) return stream.destroy(err)
      if (stream.destroyed) return

      var hex = dk.toString('hex')
      var changesHex = self.changes.discoveryKey.toString('hex')

      var archive = self.archives[hex]
      if (archive) return onarchive()

      var feed = changesHex === hex ? self.changes : self.feeds[hex]
      if (feed) return onfeed()

      function onarchive () {
        archive.metadata.replicate({
          stream: stream,
          live: true
        })
        archive.content.replicate({
          stream: stream,
          live: true
        })
      }

      function onfeed () {
        // console.log('Jim onfeed', prettyHash(feed.key),
        //             'dk:', prettyHash(feed.discoveryKey))
        if (stream.destroyed) return

        stream.on('close', onclose)
        stream.on('end', onclose)

        feed.on('_archive', onarchive)
        feed.replicate({
          stream: stream,
          live: true
        })
        // console.log('Jim feed peers', feed.peers && feed.peers.length)

        function onclose () {
          feed.removeListener('_archive', onarchive)
        }

        function onarchive () {
          if (stream.destroyed) return

          var content = self.archives[hex].content
          content.replicate({
            stream: stream,
            live: true
          })
        }
      }
    })
  }

  return stream
}

class Multicore extends EventEmitter {
  constructor (storage, opts) {
    super()
    opts = opts || {}
    this.archiver = new Archiver(storage, opts.key)
    this.ready = thunky(open)
    const self = this

    function open (cb) {
      self.opened = true
      self.archiver.on('ready', () => {
        self.emit('ready')
        cb()
      })
    }
  }

  createFeed (key, opts) {
    if (!this.opened) {
      throw new Error('multicore not ready, use .ready()')
    }
    return this.archiver.createFeed(key, opts)
  }

  createArchive (key, opts) {
    if (!this.opened) {
      throw new Error('multicore not ready, use .ready()')
    }
    return this.archiver.createArchive(key, opts)
  }

  joinSwarm (opts) {
    opts = Object.assign({}, opts, {live: true})
    // this.emit('debugLog', `Swarm opts: ${JSON.stringify(opts)}`)
    const sw = swarm(this.archiver, opts)
    this.swarm = sw
    this.archiver.ready(() => {
      const feeds = this.archiver.feeds
      Object.keys(feeds).forEach(key => {
        const feed = feeds[key]
        sw.join(feed.discoveryKey)
      })
    })
    return sw
  }

  replicateFeed (feed) {
    this.archiver.emit('replicateFeed', feed)
  }
}

// From hyperdrive
function contentKeyPair (secretKey) {
  var seed = new Buffer(sodium.crypto_sign_SEEDBYTES)
  var context = new Buffer('hyperdri') // 8 byte context
  var keyPair = {
    publicKey: new Buffer(sodium.crypto_sign_PUBLICKEYBYTES),
    secretKey: new Buffer(sodium.crypto_sign_SECRETKEYBYTES)
  }

  sodium.crypto_kdf_derive_from_key(seed, 1, context, secretKey)
  sodium.crypto_sign_seed_keypair(keyPair.publicKey, keyPair.secretKey, seed)
  if (seed.fill) seed.fill(0)

  return keyPair
}

module.exports = Multicore
