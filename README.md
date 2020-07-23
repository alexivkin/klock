# Klock of Shuba - Line of code counter for Git repositories

* Count lines of code (loc) in all your public and private repositories hosted on GitHub.com, Bitbucket.com and Gitlab.com, on-prem GitHub Enterprise, Bitbucket Server and zip archives
* Download results as JSON
* Shows the third party libraries and open source code (for example bower and node modules), test files and administrative utilities, that don't contribute to the LoC directly

### Demo

[Try it live](https://klock.herokuapp.com)

* Click sign-on. You will be redirected to the GitHub.com or Bitbucket.com. Use your credentials to login.
* You will then be asked to allow klock to access your repositories. Click yes to allow access.
* You should see your public and private repositories. Click "scan selected" and wait for the scans to complete.
* Click "get all" to download all results in the JSON format.

### Running as a docker container

To run as a local webserver

      docker run -d --name klock-server --rm -v klock:/root/.config/configstore -p 8080:8080 alexivkin/klock --webserver

To run as a command line tool

      docker run --name klock -it --rm -v klock:/root/.config/configstore alexivkin/klock

### Running natively

1. Install NodeJS 10.5+
2. Clone this repository
3. Run `npm install`
4. Register the app with the OAuth provider (see the "configuring authentication" section below)
5. Now run it as `node server.js` for the webserver or `nodejs cli.js` as a CLI

### Configuring for GitHub Enterprise

First, you need to register klock as the OAuth app in your GHE server. Go to https://yourgheserver/settings/applications/new, name the app as klock, define the home page as http://clochost:port, point the callback to http://clochost:port/gh/callback. Click OK and take note of the client ID and the secret. Set GH_OAUTH2_ID and GH_OAUTH2_SECRET environment variables to these values and run klock, like this:

`GH_OAUTH2_ID=<shorternumber> GH_OAUTH2_SECRET=<longernumberhere> nodejs cli.js --webserver --local_url https://yourgheserver --gh`

If you are using docker specify GH_OAUTH2_ID and GH_OAUTH2_SECRET using docker's `-e` option and expose the port 8080 with `-p [localport]:8080` option

### Configuring for a Bitbucket Server

No setup is needed. The app will use username/password for authentication. Simply run as

`nodejs cli.js --webserver --local_url http://yourbitbucketserver:7990 --bb`
or
`docker run -it --rm --name klock -v klock:/root/.config/configstore -p 8080:8080 alexivkin/klock  --webserver --local_url http://yourbitbucketserver:7990 --bb`

### Counting lines of code in a zip archive

`nodejs cli.js --zip file.zip`

or

`docker run -it --rm --name klock -v klock:/root/.config/configstore -v /local-folder-with-zip:/remote-folder alexivkin/klock  --zip /remote-folder/file.zip`

### Saving results to a CSV

You can convert the resulting JSON into a CSV by using a `jq` command like this:

`jq -r '{key:"repo",value:{lang:"language",total:"line count",ext:{".xml":"xml loc"}}}, to_entries[] |[.key, .value.lang, .value.total, .value.ext[".xml"] ] | @csv' klock.json > klock.csv`

The total line count includes XML lines, which are also listed in the separate column so you can subtract them manually.

## Compatibility

* Tested against
  * [GitHub.com v3 API](https://developer.github.com/v3/)
  * [GitHub Enterprise v2.14 API](https://developer.github.com/enterprise/2.14/v3/)
  * [Bitbucket.org v2 API](https://developer.atlassian.com/bitbucket/api/2/reference/)
  * [Bitbucket server v5.12](https://hub.docker.com/r/alexivkin/cxbitbucket/). Bitbucket Server uses [a different REST API](https://docs.atlassian.com/bitbucket-server/rest/5.12.0/bitbucket-rest.html) than Bitbucket.org.
* MS Edge is not supported until it gains support for server side events

## Troubleshooting

* To run klock with all the logging enabled set DEBUG environment variable to `*` (star)

	   DEBUG=* node cli.js --webserver --local_url=http://....

* If you see errors about self-signed or expired SSL certificate set the following environment variable:

	   NODE_TLS_REJECT_UNAUTHORIZED='0'

* If OAuth authentication results in the 404 error then the provided OAuth client ID does not match the client ID configured on GitHub. This is likely due using GHE and GitHub.com with the same instance of klock. Make sure to set the correct GH_OAUTH2_ID and GH_OAUTH2_SECRET

* [Development notes](https://github.com/alexivkin/klock/blob/master/DEV.md)
