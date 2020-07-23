const pkg         = require('../package.json');
const configstore = require('configstore');
const handlebars  = require('handlebars')
const sse = require('../lib/ssesocket')
const gh  = require('../lib/github');
const bb  = require('../lib/bitbucket');

const path  = require('path')
const btoa  = require('btoa-lite')
const qs    = require('querystring');
const axios = require('axios')
const fs    = require("fs");
const util  = require('../lib/util');
const tmp   = require('tmp');
const extract = require('extract-zip')

const pjson = require('../package.json'); // for the package version
const debug = require('debug')('controller')

// var qs = require('querystring');  qs.stringify( qs.parse

const conf = new configstore(pkg.name);
const ok = gh.getInstance();
const bi = bb.getInstance();

module.exports = {

  Root: (req, res) => {
    // if already logged in send to the appropriate repo list
    if (req.session.authed)
      res.redirect(`/${req.session.engine}/${req.session.user}`)
    else {
      if (process.env.LOCAL_SERVER_TYPE){  // local server
        // TODO precompile http://handlebarsjs.com/precompilation.html
        var template = handlebars.compile(fs.readFileSync(__dirname + '/../public/local.html',"utf8"));
        var local = template({gh_server:process.env.LOCAL_SERVER_TYPE == 'gh', server_url:process.env.SERVER_URL, gh_oauth : conf.get('github.oauth2'), version:'v'+pjson.version})
        res.send(local)
      } else {  // OAuth into a cloud provider
        var template = handlebars.compile(fs.readFileSync(__dirname + '/../public/index.html',"utf8"));
        var local = template({gh_oauth : conf.get('github.oauth2'),bb_oauth : conf.get('bitbucket.oauth2'), version:'v'+pjson.version})
        res.send(local)
        // res.sendFile(path.resolve(__dirname + '/../public/index.html'));
      }
    }
  },

  // username/password auth for locally hosted servers
  // OAuth1 may be possbile, but requires extra setup on the server - https://medium.com/mibexsoftware/how-to-use-oauth-with-atlassian-products-c0f357ae91eb
  // could also use app passwords - https://jira.atlassian.com/browse/BSERV-2722
  Auth: (req, res) => {
    if (req.params.eng == 'gh'){
      res.status(501).send({status:501, message: "Github Enteprise username/password login is not implemented. Use OAuth"})
    } else {
      // debug(req)
      const username = req.body.username
      const password = req.body.password
      req.session.server_url=process.env.SERVER_URL
      const server_url = process.env.SERVER_URL
      const ba = 'Basic '+btoa(`${username}:${password}`)
      bb.creds={ server_url, username, password }
      // Bitbucket Server has a differrent API - https://docs.atlassian.com/bitbucket-server/rest/5.12.0/bitbucket-rest.html
      axios.get(server_url+'/rest/api/1.0/users?filter='+username, { headers: { Authorization: ba } })
      .then(result => {
          if (!result.data.values || result.data.values.length==0){
            res.status(503).send({status:"503",message:"Cant get the user slug for "+username})
          } else {
            if (result.data.values.length > 0)
              debug("Found more than one match for "+username+" . Will use the first one.")
            req.session.authed=true
            req.session.engine="bb"
            req.session.user=result.data.values[0].slug
            req.session.ba=ba
            req.session.repostats={} // init
            bb.creds.username = req.session.user
            // res.redirect('/bb/'+req.session.user) dont work
            // debug(bb.creds)
            res.send(req.session.user)
          }
        }).catch(error => {
          // console.log(error.config);
          if (error.response) {
              // The request was made and the server responded with a status code that falls out of the range of 2xx
              // console.log(error.response.data);
              // console.log(error.response.status);
              // console.log(error.response.headers);
              debug(error.response.status,error.response.data)
              res.status(error.response.status).send(error.response.data)
          } else if (error.request) {
              // The request was made but no response was received
              // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
              // http.ClientRequest in node.js
              debug('503',error.request);
              res.status(503).send({status:503, message: "Can't communicate with "+req.session.server_url+'/rest/api/1.0/users. Try browsing directly from the server to confirm that it is reachable'})
          } else {
              // Something happened in setting up the request that triggered an Error
              debug('500', error.message);
              res.status(500).send({status:500, message: error.message})
          }
        })
    }
  },
  // OAuth authentication
  // Github full web app flow OAuth -  https://developer.github.com/apps/building-oauth-apps/authorizing-oauth-apps/
  // Bitbucket full 3-LO flow - https://developer.atlassian.com/cloud/bitbucket/oauth-2/
  //          https://developer.atlassian.com/bitbucket/api/2/reference/meta/authentication
  OAuthStart: (req, res) => {
    let creds=(req.params.eng == 'gh') ? conf.get('github.oauth2') : conf.get('bitbucket.oauth2')
    if (process.env.SERVER_URL) {
      // OAuth only works for GHE. Bitbucket local server is BA
      req.session.server_type=process.env.LOCAL_SERVER_TYPE
      req.session.server_url=process.env.SERVER_URL
      req.session.server_api_url=process.env.SERVER_URL+'/api/v3'  // GHE API - note that octokit defines this in the very beginning at require
    } else {
      if (req.params.eng == 'gh'){
        req.session.server_url = 'https://github.com'
        req.session.server_api_url = 'https://api.github.com'
      } else {
        req.session.server_url = 'https://bitbucket.org'
        req.session.server_api_url = 'https://api.bitbucket.org/2.0'
      }
    }

    if(creds && creds.id){
      // todo add state param to protect against CSRF
      if (req.params.eng == 'gh')
        res.redirect(`${req.session.server_url}/login/oauth/authorize?client_id=${creds.id}&scope=repo`)
      else {
        res.redirect(`${req.session.server_url}/site/oauth2/authorize?client_id=${creds.id}&response_type=code`)
      }
    } else {
      res.send('OAuth2 is not configured. Register the OAuth app and save the keys to '+conf.path +
      ' or set env GH_OAUTH2_ID, GH_OAUTH2_SECRET, BB_OAUTH2_ID, BB_OAUTH2_SECRET.')
    }
  },

  OAuthCallback: (req, res) => {
    if(!req.query.code){
      res.send('No OAuth2 code supplied for the callback: '+JSON.stringify(req.query))
      return
    }
    let creds=(req.params.eng == 'gh') ? conf.get('github.oauth2') : conf.get('bitbucket.oauth2')
    // todo check to make sure state param matches to protect against CSRF
    if(creds && creds.id && creds.secret) {
      if (req.params.eng == 'gh') {
        // exchange code for the token. sending as straight JSON, force a JSON return
        axios.post(req.session.server_url+'/login/oauth/access_token',{
          client_id: creds.id,
          client_secret: creds.secret,
          code: req.query.code
        }, { headers: { Accept: 'application/json' } }).then((rr) => {
          //debug(rr)
          if (rr.data.error){
            res.send('OAuth2 error: '+rr.data.error_description)
            return
          }
          //          ok.authenticate({ type : 'oauth', token : rr.data.access_token });  // does nothing but sets internal state
          // inject auth
          ok.hook.wrap("request",(f, request)=>{
    			request.headers.authorization = `bearer ${rr.data.access_token}`;
    			return f(request);
    		})

          //ok.auth({ type:'token',tokenType:'oauth',token: rr.data.access_token }).then(ress=>{
          ok.users.getAuthenticated().then(result => {
            // debug(result)
            req.session.authed=true
            req.session.engine="gh"
            req.session.user=result.data.login
            req.session.access_token=rr.data.access_token
            req.session.repostats={} // init
            // also have data.scope and data.token_type
            res.redirect('/gh/'+req.session.user)
          }).catch(err => {
            res.send('OAuth fine, but no cigar on the user: '+err)
          })
        }).catch(err => {
          res.send('Cant get the OAuth code: '+err)
        })
      } else {
        // https://developer.atlassian.com/cloud/bitbucket/oauth-2/
        axios.post(req.session.server_url+'/site/oauth2/access_token',qs.stringify({
          grant_type: 'authorization_code',
          code: req.query.code
        }), { headers: {
          Authorization: 'Basic '+btoa(`${creds.id}:${creds.secret}`),
          Accept: 'application/json' }
         }).then((rr) => {
           // debug(rr)
           if (rr.data.error){
             res.send('OAuth2 error: '+rr.data.error_description)
             return
           }
           bi.authenticate({ type : 'oauth', token : rr.data.access_token });  // does nothing but sets internal state
           axios.get(req.session.server_api_url+'/user', { headers: { Authorization: `Bearer ${rr.data.access_token}` } })
           .then(result => {
               // debug(result)
               req.session.authed=true
               req.session.engine="bb"
               req.session.user=result.data.username
               req.session.access_token=rr.data.access_token // 1hr lifetime
               // https://developer.atlassian.com/cloud/bitbucket/oauth-2/
               req.session.refresh_token=rr.data.refresh_token // this thing can be exchanged for another access token if it expires
               req.session.repostats={} // init
               // also come data.scopes, data.expires_in, data.token_type
               bb.creds.username = result.data.username

               res.redirect('/bb/'+req.session.user)
             }).catch(err => {
               res.send('OAuth fine, but no cigar on the user: '+err+", "+err.response)
             })
            }).catch(err => {
             res.send('Cant get the OAuth code: '+err)
           })
         }
    } else {
      debug('OAuth2 is not configured. Set it in '+conf.path)
      res.send('OAuth2 is not configured. Set it in '+conf.path)
    }
  },

  Main: (req , res) => {
    if (!req.session.authed){
      res.redirect(req.baseUrl + '/')
    } else
      res.sendFile(path.resolve(__dirname + '/../public/repos.html'));
  },


  // app.get('/gh/:user/repos', async (req, res) => {
  //   var socket = new sse(req, res);
  //   try {
  //     repos = await gh.getRepos()
  //     for (r in repos)
  //       socket.emit("repos", r.name)
  //     socket.emit("repos", res.length)
  //   } catch (err) {
  //     socket.emit("repos", "Nope: "+JSON.stringify(err))
  //   }
  // })
  GetRepos: (req, res, next) => {
    var socket = new sse(req, res);
    // debug(bb)

    let engine= req.params.eng == 'gh' ? gh : bb
    engine.getRepos().then(repos => {
        // debug(repos)
        // for (r of repos)
        //   socket.emit("repos", r.name)
        socket.emit("repos", repos)
      }).catch (err => {
        debug("Nope: "+JSON.stringify(err))
        socket.emit("repos", "Nope: "+JSON.stringify(err))
      })
    // next()
  },

  ScanRepo: async (req, res, next) => {
    // if (typeof(module.exports.socket) == 'undefined')
    var socket = new sse(req, res);
    debug(`Scan requested for ${req.params.user}/${req.params.repo}/${req.params.branch}`)

    let tmpname = tmp.tmpNameSync();
    let currentLength=0
    let lastpercent=0 // throttle updates over SSE
    let percent=0
    // TODO push downloader logic into an engine module
    zipfiledownloader=async () => {
      let zipurl =`${req.session.server_api_url}/repos/${req.params.user}/${req.params.repo}/zipball/${req.params.branch}` // ?access_token=${encodeURIComponent(req.session.access_token)}`
      let zipauth={ Authorization: `Bearer ${req.session.access_token}` }
      if (req.params.eng == 'bb'){
        if (req.session.server_url) { //local bitbucket
          zipurl =`${req.session.server_url}/rest/api/1.0/projects/${req.params.branch}/repos/${req.params.repo}/archive`
          zipauth={ Authorization: req.session.ba }
        } else
          zipurl =`${req.session.server_url}/${req.params.user}/${req.params.repo}/get/${req.params.branch}.zip` // ?access_token=${encodeURIComponent(req.session.access_token)}`
      }
      let response= await axios.get(zipurl,{ headers: zipauth, responseType: 'stream' })
      let updatehalted=false
      response.data.pipe(fs.createWriteStream(tmpname));
      // console.log(response.data)
      // console.log(response.data.headers['content-length'])
      // console.log(response.status)
      // console.log(response.headers['content-length'])
      // return a promise and resolve when download finishes
      return new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => {
          if (updatehalted)
            return
          currentLength+=chunk.length
          if (!response.headers['content-length']){
            // debug(`Got no content-length headers on zip for ${req.params.user}/${req.params.repo}/${req.params.branch}`)
            socket.emit("zip", "broken")
            updatehalted=true
          } else {
            // percent=Math.ceil(currentLength/response.headers['content-length']*20)*5 // stager by 5%
            percent=Math.ceil(currentLength/response.headers['content-length']*50)*2 // stager by 2%
            // debug(`Got content-length on zip for ${req.params.user}/${req.params.repo}/${req.params.branch}`)
            if(lastpercent != percent){
              // debug('sent'+percent+currentLength+response.headers['content-length'])
              socket.emit("zip", percent)
              lastpercent=percent
            }
          }
        })
        response.data.on('end', () => {
          // socket.emit("zip", 100)
          // debug('zip end')
          resolve()
        })
        response.data.on('error', () => {
            // debug('zip error')
            reject()
         })
       })
     }

     try {
       await zipfiledownloader()
     } catch (e) {
       debug("Error downloading - repo empty?", e)
       socket.emit("results","")
       return
     }

     var tmpdir=tmp.dirSync().name;
     // console.log(tree)
     //let extractSync=util.promisify(extract)
     console.log('Extracting '+tmpname+' to '+tmpdir+', please wait...')
     // an error here will cause cause the temp file and the temp folder to remain
     await extract(tmpname, {dir: tmpdir})
     debug("Starting the line count")
     fs.unlinkSync(tmpname)
     debug("1")

     tree=await util.promisify(util.walk)(tmpdir)
     debug("2")

     let extras={ 'Other':0, 'Tests':0,'Libs':0,'Admin':0 }
     let klockbylang={},klockbyext={}

     let count=0
     let files=tree.filter(x => x.type=='blob') // filter early to get the progress indicator
     // debug(tree)
     lastpercent=0
     percent=0

     for (const o of files){
       count++
       percent=Math.ceil(count/files.length*20)*5
       if(lastpercent != percent){
         socket.emit("scan", percent)
         lastpercent=percent
       }
       // count and filter out extreneous files
       if (o.path.match(req.app.locals.testRegex)){
         extras['Tests']++
         continue
       }
       if (o.path.match(req.app.locals.libRegex)){
         extras['Libs']++
         continue
       }
       let ext='.'+o.path.split('.').pop()
       // console.log(o.path.split('.'))
       if (ext in req.app.locals.cxext){
         let file=fs.readFileSync(o.path,"utf8")
         if (typeof(file) != 'string'){ // apple plists may be binary
           // console.log("Binary file "+o.path)
           continue
         }
         // below is the actial line counter. yeah, that primitive
         // it works on windows since \r will be left at the end of the line
         let loc=file?file.split('\n').length:0
         // record loc against all matching languages and the extension (to trim later)
         for (lang of req.app.locals.cxext[ext]) {
           klockbylang[lang]=lang in klockbylang ? klockbylang[lang]+loc:loc
         }
         klockbyext[ext]=ext in klockbyext ? klockbyext[ext]+loc:loc
       } else {
         extras['Other']++
       }
     }
     util.deleteFolderRecursive(tmpdir) // do this asyncly
     debug("Done counting")

     if (Object.keys(klockbylang).length == 0){
       debug("Result - none")
       socket.emit("results","")
       return
     }
     // Pick the dominant language
     let dlang = Object.keys(klockbylang).reduce((a, b) => klockbylang[a] > klockbylang[b] ? a : b);
     let repototal = Object.values(klockbyext).reduce((a, b) => a + b)
     // removeLanguageCollisions(dlang)
     debug("Result:"+dlang+" ("+repototal+") - "+JSON.stringify(klockbyext)+". "+extras.Other+" unknown files, "+extras.Tests+" test files, "+extras.Libs+" third party libs")

     // Other usefull statistics -
     //   last repo update - GH "updated_at" on the repo object.

     let stats={lang:dlang,total:repototal,ext:klockbyext,other:extras.Other,tests:extras.Tests,libs:extras.Libs}
     req.session.reload(()=>{ // reload the session before updating, since it could have been updated in a parallel request
       req.session.repostats[`${req.params.user}-${req.params.repo}-${req.params.branch}`]=stats // JSON.parse(JSON.stringify(stats)) // deep copy
       req.session.save() // for some reason it's not saved otherwise
     })
     // debug(req.session.repostats)
     socket.emit("results",stats)
     // next()
     // calculate the total
     // grandtotal+=repototal
  },

  DownloadRepoStats: async (req, res) => {
    // ${req.params.eng}-
    let name=`${req.params.user}-${req.params.repo}-${req.params.branch}`
    // debug(req.session.repostats)
    if (name in req.session.repostats) {
      // https://stackoverflow.com/questions/25434506/download-file-from-json-object-in-node-js
      // https://stackoverflow.com/questions/25206141/having-trouble-streaming-response-to-client-using-expressjs
      // let resultstream = new streams.ReadableStream(JSON.stringify(req.session.repostats[name]));
      res.set('Content-disposition', `attachment; filename=${name}.json`);
      res.set('Content-type', 'application/json');
      // resultstream.pipe(res);
      res.send(JSON.stringify(req.session.repostats[name]))
    } else {
      res.send(`No results for ${name}`)
    }
  },

  DownloadAllStats: async (req, res) => {
    // let allstream = new streams.ReadableStream(req.session.repostats);
    res.set('Content-disposition', `attachment; filename=klock.json`);
    res.set('Content-type', 'application/json');
    debug("Download request for all data") //+JSON.stringify(req.session.repostats))
    res.send(JSON.stringify(req.session.repostats))
    // allstream.on('finish',()=>{ res.end() })
    // allstream.pipe(res);
  },

  SignOut: (req, res) => {
    ok.authenticate({ type : 'oauth', token : "0" }); // invalidate the header
    bi.authenticate({ type : 'oauth', token : "0" }); // invalidate the header
    req.session.destroy() // ()=>{}
    res.redirect(req.baseUrl + '/')
  }

}
