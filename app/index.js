const express = require('express')
const path    = require('path')
const ctl     = require('./controller.js')
const session = require('express-session');
const bodyparser  = require("body-parser");
const configstore = require('configstore');
const fs      = require("fs");
const pkg     = require('../package.json');

const app = express() //.Router()
const MemoryStore = require('memorystore')(session)
const conf = new configstore(pkg.name);

// load extensions and untangle the many-to-many relationship between extensions and languages into two hashmaps of arrays
var cxext={},cxlang={}

try {
  let cxextraw = fs.readFileSync(__dirname+"/../extensions.csv", "utf-8").toString().split('\n');
  cxextraw.shift(); // drop the header
  for (l of cxextraw){
    let [ext,lang]=l.split(',')
    if (ext && lang!="Unknown") {
      cxext[ext]=ext in cxext ? cxext[ext].concat(lang):[lang]
      cxlang[lang]=lang in cxlang ? cxlang[lang].concat(ext):[ext]
    }
  }
} catch (err) {
  console.log("Can't open "+__dirname+"/extensions.csv file containing currently accepted file extensions\n"+err)
  process.exit(1)
}

app.locals.cxext=cxext
app.locals.cxlang=cxlang

// TODO move out of the code into configs.
app.locals.testRegex=new RegExp('(/.*test.*/|spec\.java$|swagger.*\.xml$)','i')
// const adminRegex="main(" // detect cli functions in code
app.locals.libRegex=new RegExp('(/bower_components/|/node_modules/)')

if (process.env.GH_OAUTH2_ID && process.env.GH_OAUTH2_SECRET) // config via env vars for remote server deployment (e.g. heroku)
    conf.set('github.oauth2',{id:process.env.GH_OAUTH2_ID, secret:process.env.GH_OAUTH2_SECRET})

if (process.env.BB_OAUTH2_ID && process.env.BB_OAUTH2_SECRET)
    conf.set('bitbucket.oauth2',{id:process.env.BB_OAUTH2_ID, secret:process.env.BB_OAUTH2_SECRET})

  // process.env.SERVER_API_URL would contain the custome server API url. Passed from the cli.js as an env variable

app.use(session({
    store: new MemoryStore({ checkPeriod: 86400000 }),// prune expired entries every 24h
    secret: process.env.SESSION_SECRET || 'somenotsosecretsecretkey',
    // todo: secure cookie for production https://www.npmjs.com/package/express-session#compatible-session-stores
    resave: false, //true, // might actually need false.
    saveUninitialized: true
}))

app.use(bodyparser.json());

app.get('/', ctl.Root)
app.use(express.static(path.join(__dirname, '../public'))) // dynamic content - during development and between version changes { maxAge: 31557600000, index : false }
app.post('/:eng/auth', ctl.Auth) // username:password auth for local git servers
app.get('/:eng/oauth', ctl.OAuthStart)
app.get('/:eng/callback', ctl.OAuthCallback)
app.get('/:eng/:user', ctl.Main)
app.get('/:eng/:user/repos', ctl.GetRepos)
app.get('/:eng/:user/:repo/:branch', ctl.ScanRepo)
app.get('/:eng/:user/:repo/:branch/download', ctl.DownloadRepoStats)
app.get('/:eng/:user/download', ctl.DownloadAllStats)
app.get('/signout', ctl.SignOut)

module.exports = app;
