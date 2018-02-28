module.exports = `<html>
<head>
  <title>My Dat Page</title>
  <style>
    body {
      font-family: monospace;
      margin: 0;
    }
    header {
      background: #80c683;
      padding: 1em;
    }
    header h1 {
      margin: 0;
    }
    .content {
      font-size: x-large;
      margin: 1.5em;
    }
    footer a {
      color: yellow;
    }
    footer {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      padding: 0.3em;
      background: #509556;
      color: white;
    }
  </style>
</head>
<body>
  <header>
    <h1>My Dat Page</h1>
  </header>

  <div class="content">
    This is my page published as a Dat archive.<br>
    <br>
    Fun times! &#x1f389;
  </div>

  <footer>
    Published to the peer-to-peer web from the
    <a href="https://codemirror-multicore.glitch.me/">
    conventional web</a>.
  </footer>
</body>
</html>
`