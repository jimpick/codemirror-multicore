const html = require('choo/html')
const devtools = require('choo-devtools')
const choo = require('choo')
const storage = require('random-access-idb')('codemirror-multicore')
const websocket = require('websocket-stream')
const pump = require('pump')
const prettyHash = require('pretty-hash')
const Editor = require('./editor')
const Multicore = require('./multicore')

const app = choo()
app.use(devtools())
app.use(store)
app.route('/', mainView)
app.mount('body')

const editor = new Editor()

function mainView (state, emit) {
  let link = html`<span class="help">Edit the HTML below, then click on "Publish" to create a new web site!</span>`
  if (state.currentArchive) {
    const url = `dat://${state.currentArchive.key.toString('hex')}`
    link = html`<a href=${url}>${url}</a>`
  }
  const optionList = Object.keys(state.archives).sort().map(
    key => html`<option value=${key}>${prettyHash(key)}</option>`)
  return html`
    <body>
      <h2>
        Create a webpage on the Peer-to-Peer Web!
      </h2>
      <header>
        <select name="docs">
          <option value="new">Create a new webpage...</option>
          ${optionList}
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
      ${editor.render()}
      <footer>
        Edit this on <a href="https://glitch.com/edit/#!/codemirror-multicore">Glitch</a>
      </footer>
    </body>
  `
}

function store (state, emitter) {
  state.archives = {}
  state.currentArchive = null
  state.title = 'My Dat Page'

  const multicore = new Multicore(storage)
  multicore.ready(() => {
    const archiverKey = multicore.archiver.changes.key.toString('hex')
    emitter.on('publish', () => {
      const archive = state.currentArchive ? state.currentArchive :
        multicore.createArchive()
      console.log('Archiver key:', archiverKey)
      const value = editor.codemirror.getValue()
      archive.ready(() => {
        console.log('Key:', archive.key.toString('hex'))
        archive.writeFile('/index.html', value, err => {
          if (err) {
            console.error('Error writing to Dat', err)
            return
          }
          console.log('Success.')
          state.currentArchive = archive
          emitter.emit('render')
        })
        multicore.replicateFeed(archive)
      })
    })
    const host = document.location.host
    const url = `wss://${host}/archiver/${archiverKey}`
    const stream = websocket(url)
    pump(
      stream,
      multicore.archiver.replicate({encrypt: false}),
      stream
    )
    Object.keys(multicore.archiver.archives).forEach(dk => {
      const archive = multicore.archiver.archives[dk]
      const key = archive.metadata.key.toString('hex')
      state.archives[key] = dk
    })
    emitter.emit('render')
  })
}



