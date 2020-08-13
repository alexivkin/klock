const octokitlib  = require('@octokit/rest');
//const octokitlib  = process.env.SERVER_URL ? require('@octokit/rest')({baseUrl:process.env.SERVER_URL+'/api/v3'}) : require('@octokit/rest'); // an ugly hack
const configstore = require('configstore');
const pkg         = require('../package.json');
const CLI         = require('clui');
const chalk       = require('chalk');
const inquirer    = require('./inquirer');

// const axios = require('axios')
const fs          = require("fs");
const util        = require('./util');
const tmp         = require('tmp');
// const fetch = require('node-fetch');
const extract     = require('extract-zip')

const debug       = require('debug')('github-engine')

const conf = new configstore(pkg.name);

// most of the code below is no longer needed with the octokit v18

class Github {
  constructor(options = {}) {
    this.octokit=new octokitlib.Octokit()
    this.creds={}
  }

  async getCreds() {
    // Fetch token from config store
    //  in github's case the username does not matter, authentication is done with just the tokens
    //  we store the username for the API calls
    creds=conf.get('github.creds');
    if(creds && creds.token) {
      return creds;
    }
    // No token found, use credentials to access github account
    let credentials = await inquirer.askGithubCredentials();
    this.octokit.authenticate({type: 'basic',username:credentials.username,password:credentials.password});
    creds={}
    creds.username=credentials.username
    // Check if access token for this app exists
    const response = await octokit.authorization.getAll();
    const accessToken = response.data.find((row) => {
      if(row.note) {
        return row.note.indexOf('KLoCK') !== -1;
      }
    })
    if(accessToken) {
      console.log(chalk.yellow('An existing access token has been found!'));
      // ask user to regenerate a new token
      creds.token = await module.exports.regenerateNewToken(accessToken.id);
    } else {
      // No access token found, register one now
      creds.token = await module.exports.registerNewToken();
    }
    conf.set('github.creds', creds) //{username:credentials.username,creds.token});
    return creds
  }

  authenticate(c) {
    octokit.authenticate({ type : 'oauth',token : c.token }); // this call is synchronous
  }

  async registerNewToken() {
    const status = new CLI.Spinner('Registering the app, please wait...');
    status.start();
    try {
      const response = await octokit.authorization.create({
        scopes: ['user', 'public_repo', 'repo', 'repo:status'],
        note: 'KLoCK of Shuba, git repo line counter'
      });
      const token = response.data.token;
      if(token) {
        return token;
      } else {
        throw new Error("Missing Token","Github token was not found in the response");
      }
    } catch (err) {
      throw err;
    } finally {
      status.stop();
    }
  }

  async regenerateNewToken(id) {
    const tokenUrl = 'https://github.com/settings/tokens/' + id;
    console.log('Please visit ' + chalk.underline.blue.bold(tokenUrl) + ' and click the ' + chalk.red.bold('Regenerate Token Button.\n'));
    const input = await inquirer.askRegeneratedToken();
    if(input) {
      return input.token;
    }
  }

  async paginate(method, opts = {}) {
    let response = await method({per_page: 500, ...opts});
    let {data} = response;
    while (octokit.hasNextPage(response)) {
      response = await octokit.getNextPage(response);
      data = data.concat(response.data);
    }
    return data;
  }

  getRepos() {
    return this.octokit.paginate(this.octokit.repos.listForAuthenticatedUser, {});
  }

  getRepo(owner,repo) {
    return this.octokit.repos.get({owner,repo});
  }

  async getAllBranches(owner, repo) {
    return await this.octokit.paginate(this.octokit.repos.getBranches,{owner, repo});
  }

  async getLastCommits(owner,repo, branch,per_page) {
    // reverse chronological order
    return (await this.octokit.repos.listCommits({owner, repo, sha: branch, per_page})).data //, sha, path, author, since, until, per_page, page})
  }

  async getAllCommits(owner,repo, branch) {
    // https://octokit.github.io/rest.js/#api-Repos-listCommits
    return await this.octokit.paginate(this.octokit.repos.listCommits,{owner, repo, sha: branch, per_page:100}) //, sha, path, author, since, until, per_page, page})
  }

  async fastForward(owner,repo, branch, sha){
    return await this.octokit.git.updateRef({owner, repo, ref:'heads/'+branch, sha, force:true}) // force:true overrides all changes in the source
  }

  async getBranches(repo) { await octokit.paginate(octokit.repos.getBranches,{owner:creds.username, repo}) }

  tmpdir(){}

  async getTree(reponame,branch){
    // getarchivelink takes a while so start displaying progress now
    // console.log('Downloading '+repo+' '+branch+', please wait...');
    // there is a bug - it should return a redirect link, but instead returns the file
    // this will fail on multigb archives since it all goes into the memory

    // an alternative is to get the link from the header with axios and them stream the data with axios
    // see controller.js ScanRepo for the correct implementation:
    // https://api.github.com/repos/${req.params.user}/${req.params.repo}/zipball/${req.params.branch}?access_token=${encodeURIComponent(req.session.access_token)}`
    // see here for the original issue - https://github.com/octokit/rest.js/issues/916

    const status = new CLI.Spinner('Downloading and extracting '+reponame+' ,please wait...');
    status.start();
    const archive = await this.octokit.repos.getArchiveLink({owner:creds.username, repo:reponame, archive_format:'zipball', ref:branch})
    status.stop();
    // console.log(archivelink)

    let tmpname = tmp.tmpNameSync();
    fs.writeFileSync(tmpname, archive.data);

    module.exports.tmpdir=tmp.dirSync();
    // console.log(tree)
    let extractSync=util.promisify(extract)
    // console.log('Extracting '+tmpname+' to '+tmpdir.name+', please wait...')
    await extractSync(tmpname, {dir: module.exports.tmpdir.name})
    fs.unlink(tmpname,()=>{}); // or fs.unlinkSync(tmpname)

    tree=util.promisify(util.walk)(module.exports.tmpdir.name)

    // repo.default_branch=tmpdir // override with the disk location
    return tree
  }

  // https://developer.github.com/v3/git/trees/#get-a-tree
  async getTreeWithAPI(reponame,branch) {
    // console.log(owner+":"+repo+":"+branch)
    const b = await this.octokit.paginate(this.octokit.repos.getBranch,{owner:creds.username, repo:reponame, branch:branch}); // gotta paginate for 'commit' to come through
    // console.log(b.commit)
    // paginate otherwise the tree.tree is async
    const result = await this.octokit.paginate(this.octokit.git.getTree,{owner:creds.username, repo:reponame, tree_sha:b.commit.commit.tree.sha, recursive:1});
    if (result.truncated){
      console.log(chalk.yellow('Warning: more files and folders that is supported by the Gitdata Tree API. LoC will be likely be less than actual'))
    }
    return result.tree;
  }

  async getTreeWithAPI(reponame,branch,path){
    return {data:fs.readFileSync(path,"utf8")}
  }

  async getRawContentWithAPI(reponame,branch,path){
    // files up to 1 megabyte in size.
    // if the branch is omitted it will be default_branch
    // file content could also be downloaded as json at o.url. content is base64 in the content field.
    const result = await this.octokit.repos.getContent({owner:creds.username, repo:reponame, ref:branch, path:path, headers: {'Accept': 'application/vnd.github.v3.raw'}})
    return result
  }

  cleanup(){
    // console.log('Recursive delete of '+module.exports.tmpdir.name)
    util.deleteFolderRecursive(module.exports.tmpdir.name) // do this asyncly
   }
};

module.exports.Github = Github
