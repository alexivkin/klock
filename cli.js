#!/usr/bin/env node

const fs = require("fs");
const path = require('path');
const minimist = require('minimist')
// CLI fun
const chalk  = require('chalk');
// const clear  = require('clear');
const figlet = require('figlet');
const CLI    = require('clui');
const pjson = require('./package.json'); // for the package version

const usage = `
  Usage:
             klock [--bb|--gh|--zip file.zip] [--webserver] [--local_url https://server.dom] [--loco]

  Required parameters. One of the following:
             --gh           Connect to GitHub.com or a local Github Enterprise server
             --bb           Connect to BitBucket.org or a local Bitbucket server
             --zip          Count lines for the code from a zip archive. Must supply the zip file location

  Optional paramaters:
             --webserver       Start a webserver interface
             --local_url url   Local Bitbucket or GitHub Enterpriese server API url in the http(s)://server:port format
             --loco            Paranoid mode. Use APIs to browse repositories file-by-file, never saving any content to disk. It's slower than the normal mode.
`

const run = async () => {
  // console.log("\n"+chalk.yellow(figlet.textSync('klock', { font:'Nancyj', horizontalLayout: 'full' })));// Kban is good too
  // console.log(chalk.yellow(figlet.textSync('v'+pjson.version, { font:'Mini', horizontalLayout: 'full' })));
  console.log("\n"+chalk.yellow(figlet.textSync('klock '+pjson.version, { font:'Nancyj', horizontalLayout: 'full' })))
  // console.log(figlet.textSync(' v'+pjson.version, { font:'Mini', horizontalLayout: 'full' }))// Kban is good too

  var argv = minimist(process.argv.slice(2))
  if ('webserver' in argv){
    // pass the URL to the server in an env variables

    if ('local_url' in argv) {
      process.env['SERVER_URL']=argv['local_url']
      if (!('bb' in argv || 'gh' in argv)){
        console.log(chalk.red('Please specify the type of your local server using the --bb or --gh parameter'))
        return
      } else {
        process.env['LOCAL_SERVER_TYPE']='bb' in argv ? 'bb':'gh'
      }
    } else {
      console.log(chalk.red('You have not specified the url for the local Github or Bitbucket server. Will use github.com and bitbucket.org'))
    }
    require('./server')
    return
  }

  if ('local_url' in argv) {
      console.log(chalk.red('Bitbucket local server and Github enterprise are not supported by the CLI interface. Please start the web interface'))
      return
  }

  if (!('bb' in argv || 'gh' in argv || 'zip' in argv)){
    console.log(chalk.cyan(usage))
    process.exit(0)
  }

  // got to do it here because of the way octokit is created with the default baseUrl
  // Source code suppliers
  const gh     = require('./lib/github');
  const bb     = require('./lib/bitbucket');
  const zip     = require('./lib/zip');

  console.log(chalk.green('Running in console mode'))

  // TODO move out of the code into configs.
  // NOTE this is for CLI only, web uses the pattern from index.js
  const testRegex=new RegExp('(/.*test.*/|spec\.java$|swagger.*\.xml$)','i') // using new RegExp insted of / / string so we dont have to escape slashes for path matching
  // const adminRegex="main(" // detect cli functions in code
  const libRegex=new RegExp('(/bower_components/|/node_modules/)')

  var engine=gh
  if ('bb' in argv) {
    engine=bb
  } else if ('zip' in argv) {
  // unzip and scan a zip
    engine=zip
    var zipfile=argv['zip']
  }
  var loco='loco' in argv

  // console.log(argv)
  // const basedir=path.basename(__dirname); //path.basename(path.dirname(fs.realpathSync(__filename)));
  // read the extensions into an object
  var cxext={},cxlang={}
  var allklock={'Total':{}}
  // load extensions and untangle the many-to-many relationship between extensions and languages into two hashmaps of arrays
  try {
    let cxextraw = fs.readFileSync(__dirname+"/extensions.csv", "utf-8").toString().split('\n');
    cxextraw.shift(); // drop the header
    for (l of cxextraw){
      let [ext,lang]=l.split(',')
      if (ext && lang!="Unknown") {
        cxext[ext]=ext in cxext ? cxext[ext].concat(lang):[lang]
        cxlang[lang]=lang in cxlang ? cxlang[lang].concat(ext):[ext]
      }
    }
  } catch (err) {
    console.log(chalk.red("Can't open "+__dirname+"/extensions.csv file containing currently accepted file extensions\n"+err))
    process.exit(1)
  }
  // authenticate
  try {
    const creds = await engine.getCreds();
    engine.authenticate(creds,zipfile)
    // console.log(chalk.green("> Authentcated")) - misleading as no auth is done at this stage
  } catch(err) {
    if (err) {
      switch (err.code) {
        case 401:
          console.log(chalk.red('Couldn\'t log you in. Please provide correct credentials/token.'));
          break;
        default:
          console.log(err);
      }
    }
    process.exit(2)
  }

  try {
    const status = new CLI.Spinner('Getting the repo list, please wait...');
    status.start();
    // paginate through repos
    const repos=await engine.getRepos();
    // console.log(repos)
    status.stop();
    let grandtotal=0
    for (const repo of repos) {
      let extras={ 'Other':0, 'Tests':0,'Libs':0,'Admin':0 }
      let klockbylang={},klockbyext={}
      let tree={}
      // console.log(repo.name+'/'+repo.default_branch+':'+repo.size) //+(repo.private?'private ':'')+(repo.fork?'fork ':'')
      if (!loco){
        // const status = new CLI.Spinner('Downloading and extracting '+repo.name+' ,please wait...');
        // status.start();
        tree=await engine.getTree(repo.name,repo.default_branch,'/')
        // status.stop();
      }
      else {
        const status = new CLI.Spinner('Crawling the '+repo.name+' repo, please wait...');
        status.start();
        tree=await engine.getTreeWithAPI(repo.name,repo.default_branch,'/')
        // console.log(tree)
        status.stop();
      }
      let count=0
      let files=tree.filter(x => x.type=='blob') // filter early to get the progress indicator
      const progress=new CLI.Progress(40)
      for (const o of files){
        count++
        process.stdout.write('\r'+repo.name+' '+repo.default_branch+":"+progress.update(count,files.length)) // console log puts out a new line
        // count and filter out extreneous files
        if (o.path.match(testRegex)){
          extras['Tests']++
          continue
        }
        if (o.path.match(libRegex)){
          extras['Libs']++
          continue
        }
        let ext='.'+o.path.split('.').pop()
        // console.log(o.path.split('.'))
        if (ext in cxext){
          let file
          if (!loco)
            file=await engine.getRawContent(repo.name,repo.default_branch,o.path)
          else
            file=await engine.getRawContentWithAPI(repo.name,repo.default_branch,o.path)
          if (typeof(file.data) != 'string'){ // apple plists may be binary
            // console.log("Binary file "+o.path)
            continue
          }
          // below is the actial line counter. yeah, that primitive
          // it works on windows since \r will be left at the end of the line
          let loc=file.data?file.data.split('\n').length:0
          // record loc against all matching languages and the extension (to trim later)
          for (lang of cxext[ext]) {
            klockbylang[lang]=lang in klockbylang ? klockbylang[lang]+loc:loc
          }
          klockbyext[ext]=ext in klockbyext ? klockbyext[ext]+loc:loc
        } else {
          extras['Other']++
        }
      }
      if (!loco)
        engine.cleanup(repo) // remove downloaded code, if any

      if (Object.keys(klockbylang).length == 0){
        console.log('\n'+repo.name+' '+repo.default_branch+": No compatible files")
        continue
      }
      // Pick the dominant language
      let dlang = Object.keys(klockbylang).reduce((a, b) => klockbylang[a] > klockbylang[b] ? a : b);
      let repototal = Object.values(klockbyext).reduce((a, b) => a + b)
      // removeLanguageCollisions(dlang)
      console.log('\n'+repo.name+' '+repo.default_branch+": "+dlang+" ("+repototal+") - "+JSON.stringify(klockbyext)+". "+extras.Other+" unknown files, "+extras.Tests+" test files, "+extras.Libs+" third party libs")
      // calculate the total
      grandtotal+=repototal
      allklock[repo.name]=klockbyext
    }
    console.log('Grand total: '+ grandtotal)
    fs.writeFileSync(__dirname+'/loc.json', JSON.stringify(allklock), 'utf8');
  } catch(err) {
    if (err) {
      switch (err.code) {
        case 401:
        console.log(chalk.red('Unauthorized. Please provide correct credentials/token.'));
        break;
        default:
        console.log(err);
      }
    }
    process.exit(3)
  }
}

const removeLanguageCollisions = (dlang) => {
  // Since languages are counted multiple times per extension we can use next code to remove line counts from non-dominant languages
  // Works fine for one language but this is still incompleted as the secondary languages have collisions too
  let exts = [cxlang[dlang], Object.keys(klockbyext)].reduce((a, b) => a.filter(c => b.includes(c))); // array intersection to get to applicable extensions
  for (e of exts){
    let langs = [cxext[e], Object.keys(klockbylang)].reduce((a, b) => a.filter(c => b.includes(c)));
    for (l of langs.filter(a => a !== dlang)){ // remove dominant language from the list
        console.log(l+'-'+klockbylang[l]+"-="+klockbyext[e])
        klockbylang[l]-=klockbyext[e]
    }
  }
  // todo
  // remove 0 size languages, continue on the next dominant languages, stop when there is nothing else to remove.
  // let dlang = Object.keys(klockbylang).reduce((a, b) => klockbylang[a] > klockbylang[b] ? a : b);
  // removeLanguageCollisions(dlang)
}


run()
