AEM Bulk Operations CLI
===


### Install

```
npm install -g aem-bulk
```


### Usage

```
Usage: aem-bulk <command> [options]

Commands:
  aem-bulk publish             Publish pages to AEM Edge Delivery (URLs should be of type "https://<branch>--<repo>--<ow
                               ner>.hlx.page/<path>")
  aem-bulk login               Login to an AEM Edge Delivery project and save credentials locally (~/aem-ed-credentials.
                               json)
  aem-bulk screenshot          Take full page screenshot for a list of URLs
  aem-bulk lighthouse          Execute Lighthouse analysis for a list of URLs
  aem-bulk importer <command>  importer group

Options:
  --version                Show version number                                                                 [boolean]
  --log-level, --logLevel  Log level              [string] [choices: "debug", "info", "warn", "error"] [default: "info"]
  --log-file, --logFile    Log file                                                                             [string]
  --workers                Number of workers to use (max. 5)                                       [number] [default: 1]
  --help                   Show help                                                                           [boolean]
```


### Local Development

#### Install

```
npm install
```

#### Run

```
node index.js
```


### TODOs

* [x] Add reporting (csv, xlsx?) to, for example help re-run operations on failed URLs
* [ ] Add unit tests
* [ ] Accept non Franklin URLs (user would then pass org, repo, branch as parameters)
