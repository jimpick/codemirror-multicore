const Nanocomponent = require('nanocomponent')
const html = require('choo/html')
const CodeMirror = require('codemirror')
const css = require('sheetify')

require('codemirror/mode/htmlmixed/htmlmixed')
css('codemirror/lib/codemirror.css')

class Editor extends Nanocomponent {
  constructor (indexHtml) {
    super()
    this.indexHtml = null
  }

  createElement (indexHtml) {
    this.indexHtml = indexHtml
    return html`<div id="editor"></div>`
  }

  load (el) {
    this.codemirror = CodeMirror(el, {
      lineNumbers: true,
      mode: 'text/html',
      value: this.indexHtml
    })
  }

  // Implement conditional rendering
  update (indexHtml) {
    this.indexHtml = indexHtml
    this.codemirror.setValue(this.indexHtml)
    // FIXME: update codemirror
    return false
  }
}

module.exports = Editor
