Franklin Bulk Operations CLI
===

### Install

```
npm install -g franklin-bulk
```

### Usage

```
franklin-bulk <command>

Commands:
  franklin-bulk lighthouse  Executes Lighthouse analysis for a list of URLs
  franklin-bulk live        Publish pages to live stage on Franklin
  franklin-bulk preview     Publish pages to preview stage on Franklin
  franklin-bulk screenshot  Take full page screenshots for given list of URLs

Options:
      --version  Show version number                                                                                               [boolean]
  -h             Show help                                                                                                         [boolean]
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

* [ ] Add unit tests
* [ ] Add reporting (csv, xlsx?) to, for example help re-run operations on failed URLs
* [ ] Accept non Franklin URLs (user would then pass org, repo, branch as parameters)
