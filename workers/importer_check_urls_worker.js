const { parentPort } = require('worker_threads');
const axios = require('axios');

/*
 * Worker thread
 */

// Listen for messages from the parent thread
parentPort.on('message', async (msg) => {
  if (msg && msg.type === 'exit') {
    // If the parent thread sent 'exit', exit the worker thread
    process.exit();
  } else {
    console.log(msg.options)
    try {
      const url = msg.url;

      const response = await axios.head(url, {
        timeout: msg.options.timeout * 1000,
      });

      parentPort.postMessage({
        url: msg.url,
        passed: true,
        postMsg: `- ${response.status}`,
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
