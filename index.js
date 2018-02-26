const html = require('choo/html')
const devtools = require('choo-devtools')
const choo = require('choo')
const storage = require('random-access-idb')('codemirror-multicore')
const websocket = require('websocket-stream')
const pump = require('pump')
const prettyHash = require('pretty-hash')
const toBuffer = require('to-buffer')
const hyperdrive = require('hyperdrive')
const hypercore = require('hypercore')
const Editor = require('./editor')
const Multicore = require('./multicore')
const template = require('./template')

require('events').prototype._maxListeners = 100

const app = choo()
app.use(devtools())
app.use(store)
app.route('/', mainView)
app.route('/page/:key', mainView)
app.mount('body')

const editor = new Editor()

function mainView (state, emit) {
  let link = html`<span class="help">Edit the HTML below, then click on "Publish" to create a new web site!</span>`
  if (state.currentArchive && state.currentArchive.key) {
    const url = `dat://${state.currentArchive.key.toString('hex')}`
    link = html`<a href=${url}>${url}</a>`
  }
  const optionList = Object.keys(state.archives).sort().map(key => {
    let label = prettyHash(key)
    const title = state.archives[key].title
    if (title) {
      label += ` ${title}`
    }
    return html`<option value=${key}>${label}</option>`
  })
  const optGroup = optionList.length > 0 ? html`
    <optgroup label="Load">
      ${optionList}
    </optgroup>` : null
  return html`
    <body>
      <h2>
        Create a webpage on the Peer-to-Peer Web!
      </h2>
      <header>
        <select name="docs" onchange=${selectPage}>
          <option value="new">Create a new webpage...</option>
          ${optGroup}
        </select>
        <div class="title">
          <span>Title:</span>
          <input id="title" name="title" value="${state.title}">
        </div>
        <button class="publishBtn" onclick=${() => emit('publish')}>
          Publish
        </button>
        <div class="link">
          ${link}
        </div>
      </header>
      ${editor.render(state.indexHtml)}
      <footer>
        Edit this on <a href="https://glitch.com/edit/#!/codemirror-multicore">Glitch</a>
      </footer>
    </body>
  `
  
  function selectPage (e) {
    const key = e.target.value
    emit('pushState', `/page/${key}`)
  }
}

function store (state, emitter) {
  state.archives = {}
  state.currentArchive = null
  state.indexHtml = ''
  state.title = ''

  function debugStorage (name) {
    console.log('debugStorage:', name)
    return storage(name)
  }
  const multicore = new Multicore(debugStorage)
  multicore.ready(() => {
    const archiverKey = multicore.archiver.changes.key.toString('hex')

    emitter.on('publish', () => {
      const archive = state.currentArchive ? state.currentArchive :
        multicore.createArchive()
      console.log('Archiver key:', archiverKey)
      const value = editor.codemirror.getValue()
      archive.ready(() => {
        const key = archive.key.toString('hex')
        console.log('Key:', key)
        console.log('Secret Key:', archive.metadata.secretKey)
        setTimeout(() => {
          readSecretKey(archive.discoveryKey.toString('hex'), () => {
            console.log('Jim publish secretKey read')
          })
        }, 2000)
        const datJson = {
          url: `dat://${key}/`,
          title: document.getElementById('title').value,
          description: ''
        }
        archive.writeFile('/dat.json', JSON.stringify(datJson, null, 2), err => {
          if (err) {
            console.error('Error writing to Dat', err)
            return
          }
          archive.writeFile('/index.html', value, err => {
            if (err) {
              console.error('Error writing to Dat', err)
              return
            }
            console.log('Success.')
            state.currentArchive = archive
            emitter.emit('pushState', `/page/${key}`)
            // multicore.replicateFeed(archive)
          })
        })
      })
    })

    emitter.on('navigate', () => {
      console.log('Jim navigate', state)
      updateDoc()
    })
    
    const host = document.location.host
    // const url = `wss://${host}/archiver/${archiverKey}`
    const url = `ws://${host}/archiver/${archiverKey}`
    const stream = websocket(url)
    pump(
      stream,
      multicore.archiver.replicate({encrypt: false}),
      stream
    )
    multicore.archiver.on('add-archive', readMetadata)
    Object.keys(multicore.archiver.archives).forEach(dk => {
      const archive = multicore.archiver.archives[dk]
      readMetadata(archive.metadata, archive.content)
    })
    updateDoc()
    
    function updateDoc () {
      if (!state.params.key) {
        console.log('Jim reset doc')
        state.title = 'My Dat Page'
        state.indexHtml = template
        emitter.emit('render')
      } else {
        const key = state.params.key
        if (state.currentArchive && state.currentArchive.metadata.key.toString('hex') === key) return
        let archive
        if (state.archives[key] && state.archives[key].archive) {
          archive = state.archives[key].archive
          console.log('Key found (cached)', key)
        } else {
          const dk = hypercore.discoveryKey(toBuffer(key, 'hex')).toString('hex')
          if (multicore.archiver.archives[dk]) {
            const {metadata, content} = multicore.archiver.archives[dk]
            readSecretKey(dk, () => { console.log('Jim read secret key done.') })
            const options = {
              metadata,
              content,
              sparse: true,
              sparseMetadata: true
            }
            archive = new hyperdrive(null, key, options)
            state.archives[key].dk = dk
            state.archives[key].archive = archive
            console.log('Key found (loaded)', key)
          } else {
            console.error('Key not found locally', key)
            // FIXME: Throw
            return
          }
        }
        archive.readFile('index.html', 'utf-8', (err, data) => {
          if (err) {
            console.error('Error reading index.html', key, err)
            return
          }
          try {
            state.indexHtml = data
            state.currentArchive = archive
            emitter.emit('render')
          } catch(e) {
            // FIXME: Throw an error to the UI
          }
        })
      }
    }
    
    function readMetadata (metadata, content) {
      const key = metadata.key.toString('hex')
      const dk = metadata.discoveryKey.toString('hex')
      state.archives[key] = {
        dk
      }
      emitter.emit('render')
      let archive
      if (state.archives[key].archive) {
        archive = state.archives[key].archive
      } else {
        readSecretKey(dk, () => { console.log('Jim read secret key done.') })
        const options = {
          metadata,
          content,
          sparse: true,
          sparseMetadata: true
        }
        archive = new hyperdrive(null, key, options)
        state.archives[key].archive = archive
      }
      archive.readFile('dat.json', 'utf-8', (err, data) => {
        if (err) {
          console.error('Error reading dat.json', key, err)
          return
        }
        try {
          const {title} = JSON.parse(data.toString())
          state.archives[key].title = title
          if (state.params.key === key) state.title = title
          emitter.emit('render')
        } catch(e) {
          // Don't worry about it
        }
      })
    }
    
    function readSecretKey (dk, cb) {
      const path = 'feeds/' + dk.slice(0, 2) + '/' + dk.slice(2, 4) + '/' + dk.slice(4) + '/secret_key'
      const privateKeyFile = storage(path)
      privateKeyFile.read(0, 64, (err, data) => {
        if (err) {
          console.error('readSecretKey error', path, err)
          return cb(err)
        }
        console.log('Jim secret key', data)
        cb(null, data)
      })
    }
  })
}



