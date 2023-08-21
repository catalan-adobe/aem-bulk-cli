const { parentPort } = require('worker_threads');
const axios = require('axios');
const path = require('path');
const os = require('os');
const fs = require('fs');

const FRANKLIN_API_HOST = 'https://admin.hlx.page';

// global variables for this worker instance
let franklinStage = null;

/*
 * Helper Functions
 */

function buildAPIURL(stage, url) {
  const u = new URL(url);
  const [branch, repo, org] = u.host.split('.')[0].split('--');
  return [FRANKLIN_API_HOST, stage, org, repo, branch].join('/') + u.pathname;
}

/*
 * Worker thread
 */

// Listen for messages from the parent thread
parentPort.on('message', async (msg) => {
  // console.log('message received', msg);
  if (msg && msg.type === 'exit') {
    // If the parent thread sent 'exit', exit the worker thread
    process.exit();
  } else {
    if (msg.options?.stage) {
      franklinStage = msg.options.stage;
    }

    try {
      const url = buildAPIURL(franklinStage, msg.url);
      let reqOptions = null;

      // authentication
      let authToken = null;
      const authFile = path.join(os.homedir(), '.frk-cli-credentials.json');
      if (process.env.FRANKLIN_API_TOKEN) {
        authToken = process.env.FRANKLIN_API_TOKEN;
      } else if (fs.existsSync(authFile)) {
        const credentials = JSON.parse(fs.readFileSync(authFile));
        if (url.includes(credentials.path)) {
          authToken = credentials.auth_token;
        }
      }

      if (authToken) {
        reqOptions = {
          headers: {
            'X-Auth-Token': authToken,
          },
        };
      }

      const response = await axios.post(url, null, reqOptions);

      parentPort.postMessage({
        url: msg.url,
        passed: true,
        result: `Success: ${response.status}`,
      });
    } catch (error) {
      parentPort.postMessage({
        url: msg.url,
        passed: false,
        result: error.message,
      });
    }
  }
});
