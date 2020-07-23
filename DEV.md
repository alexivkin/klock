# Development Notes

* Registering klock as an OAuth app on GitHub.com:
Go to [new OAuth app](https://github.com/settings/applications/new), name the app, define home page as http://clochost:port,
point the callback to http://clochost:port/gh/callback. No need to specify permissions scopes as they are handled at the access time. Copy key and secret and then set GH_OAUTH2_ID and GH_OAUTH2_SECRET environment variables and run klock so it can store them. With docker you can do it using the docker `-e` option.

* Registering klock as an OAuth app on Bitbucket.org:
Go to [new OAuth consumer](https://bitbucket.org/account/user/alexivkin/oauth-consumers/new). Give read permissions to the account and the repositories. Point the callback to http://yourhost:port/bb/callback. Copy key and secret and then set BB_OAUTH2_ID and BB_OAUTH2_SECRET environment variables and run klock so it can store them

* Running webserver on a port other than the default 8080
Set the PORT environment variable.

## Docker specifics

* The app stores credentials in /root/.config/configstore, hence the volume mount with docker. To remove stored credentials run `docker volume rm klock`
* To supply the local zip file with `--zip` option first map a host folder into the docker container using the docker volume mapping.

## Updating supported languages

klock reads the list supported languages and extensions from the extensions.csv file. Everything else is ignored.

## CLI mode

CLI uses private keys that are unique to the app, instead of OAuth

* GitHub - the CLI will self-register in GitHub when you supply your username and a password. Your name and password are never stored. The app will have have user, public_repo, repo and repo:status scopes.
* Bitbucket - There is no self-register API so you will need to create the Bitbucket app password manually. You will need to supply it with repositories_read and user_read permissions. To create an app password, go to Bitbucket settings, click App passwords, click create app password. Copy the generated password and paste it into the application. Notes on the app passwords:
  * You cannot view an app password or adjust permissions after you create the app password. They are designed to be disposable.
  * You cannot use them to log into your Bitbucket account.
  * App passwords are tied to your account's credentials and should not be shared. You can set permission scopes (specific access rights) for each app password.

Authentication details are saved in the configstore, so you only need to do it once. To reset authentication simply remove `.config/configstore`. If you are running docker as described above run `docker volume rm klock`

* In the CLI you can use the `--loco` option to instruct the app to never clone or download the repo as the whole. Instead it will count the number of lines through the API calls. It will be quite a bit slower, and may trigger rate limiting on the public servers.
* Results of the CLI run are saved to `loc.json`

### Known issues

  * Empty repos crash the CLI when returning the 404
  * The `--loco` mode may run into API limits, e.g:
    * Bitbucket has rate limiting and until they get the proper file tree supported in the API this may trigger the limit (5k requests/hr)
    * Github will return zip files up to 1 megabyte in size
  * Right now all auth is custom coded. Should switch to PassportJS.
  * GH OAuth client Id and secret are not saved on per-server basis, so if you use both Github.com and GHE or multiple GHE's this may cause problems
  * klock works by downloading a zip archive of the repository. An alternative is to clone the repo without the history, to avoid bringing to much irrelevant data: `git clone -b master --single-branch --depth 1 git://sub.domain.com/repo.git`
  * Assumes utf8 in source files

##  Technology

Web client-side

  * Full flow OAuth 2.0 for GitHub and Bitbucket
  * [Bootstrap 4](https://getbootstrap.com/docs/4.0/getting-started/introduction/) layout
  * [Handlebars](http://handlebarsjs.com/) templating (on the client and on the [server](https://www.npmjs.com/package/handlebars))
  * [ServerSideEvents](https://developer.mozilla.org/en-US/docs/Web/API/EventSource)

Web server-side

  * [NodeJS](https://nodejs.org/api/), npm, ES6, [template literals](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals), async/await and Promises
  * [Express 4](https://expressjs.com/en/4x/api.htm)
  * [Octokit Rest.JS](https://octokit.github.io/rest.js/),[Bitbucket NPM](https://bitbucketjs.netlify.com/) abstractions and native calls with the [Axios](https://github.com/axios/axios) request client
  * [Live server reload](https://codeburst.io/dont-use-nodemon-there-are-better-ways-fc016b50b45e)
  * API request pagination to support large accounts and repositories through

CLI

  * Prettified with chalk, figlet, clui spinners and progress bars
  * Interactive components with inquirer
  * Out-of-band progress updates during downloading, unzipping, recursive tree building and source parsing

### References

API

  * [GitHub v3 API](https://developer.github.com/v3/) (for github.com)
  * [Bitbucket v2 API](https://developer.atlassian.com/bitbucket/api/2/reference/) (for bitbucket.org)
  * [Bitbucket v1 API](https://docs.atlassian.com/bitbucket-server/rest/4.11.1/bitbucket-rest.html) (for bitbucket server)

Javascript

  * [Understand promises before you start using async/await](https://medium.com/@bluepnume/learn-about-promises-before-you-start-using-async-await-eb148164a9c8)
  * [Problems with promises](https://pouchdb.com/2015/05/18/we-have-a-problem-with-promises.html)
  * [Getting to know asynchronous JavaScript: Callbacks, Promises and Async/Await](https://medium.com/codebuddies/getting-to-know-asynchronous-javascript-callbacks-promises-and-async-await-17e0673281ee)
  * [Using Async Await in Express with Node 9](https://medium.com/@Abazhenov/using-async-await-in-express-with-node-8-b8af872c0016)
  * [Server Side Events insights](https://www.fastly.com/blog/server-sent-events-fastly)
  * [How Octokit Rest.JS works](https://github.com/octokit/rest.js/blob/master/HOW_IT_WORKS.md)

Samples

  * [Node.js starter with OAuth samples](https://github.com/sahat/hackathon-starter)
  * [Live reload server without resetting connections ](https://blog.cloudboost.io/reloading-the-express-server-without-nodemon-e7fa69294a96)
  * [Client and Server side live reload](https://github.com/glenjamin/ultimate-hot-reloading-example)
  * [Single repo line counter](http://line-count.herokuapp.com/) using git clone. [Source](https://github.com/cb372/line-count)
