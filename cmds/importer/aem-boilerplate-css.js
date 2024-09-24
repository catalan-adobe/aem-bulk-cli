/*
 * Copyright 2023 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import fs from 'fs';
// import * as csstree from 'css-tree';
// import cssbeautify from 'cssbeautify';
// import beautify from 'simply-beautiful';
import path from 'path';
import { getLogger } from '../../src/logger.js';
import { CommonCommandHandler, withCustomCLIParameters } from '../../src/cli.js';

// const fontFieldsMapping = [
//   ['ascent-override', 'ascentOverride'],
//   ['descent-override', 'descentOverride'],
//   ['font-display', 'fontDisplay'],
//   ['font-family', 'fontFamily'],
//   ['font-stretch', 'fontStretch'],
//   ['font-style', 'fontStyle'],
//   ['font-weight', 'fontWeight'],
//   ['font-feature-settings', 'fontFeatureSettings'],
//   ['font-variation-settings', 'fontVariationSettings'],
//   ['line-gap-override', 'lineGapOverride'],
//   ['size-adjust', 'sizeAdjust'],
//   ['src', 'src'],
//   ['unicode-range', 'unicodeRange'],
// ];

/**
 * main
 */

export default function aemBoilerplateCSSCmd() {
  return {
    command: 'aem-boilerplate-css',
    describe: 'Extract CSS for AEM Boilerplate styles',
    builder: (yargs) => {
      withCustomCLIParameters(yargs, { inputs: false, workers: false })
        .option('url', {
          describe: 'URL to extract minimal CSS',
          demandOption: true,
          type: 'string',
        })
        .option('boilerplate-folder', {
          alias: 'boilerplateFolder',
          describe: 'Folder to the boilerplate project',
          type: 'string',
        });
    },
    handler: (new CommonCommandHandler()).withHandler(async ({
      argv, logger, AEMBulk,
    }) => {
      // return;
      let browser;
      let page;

      try {
        const fontsFolder = path.join(argv.boilerplateFolder, 'fonts');
        const stylesFolder = path.join(argv.boilerplateFolder, 'styles');
        const cssFontsFile = path.join(stylesFolder, 'fonts.css');
        const cssStylesFile = path.join(stylesFolder, 'styles.css');

        if (!fs.existsSync(cssStylesFile)) {
          throw new Error(`Styles CSS file ${cssStylesFile} does not exist, aborting computation`);
        }

        if (!fs.existsSync(fontsFolder)) {
          logger.warn(`Fonts folder ${fontsFolder} does not exist, creating it...`);
          fs.mkdirSync(fontsFolder, { recursive: true });
        }
        if (!fs.existsSync(cssFontsFile)) {
          logger.warn(`Fonts CSS file ${cssFontsFile} does not exist, creating it...`);
        }

        const url = new URL(argv.url);
        logger.debug(`handler - minimal css start for url ${argv.url}`);

        [browser, page] = await AEMBulk.Puppeteer.initBrowser({
          headless: true,
          adBlocker: true,
          gdprBlocker: true,
          devTools: true,
        });

        await page.goto(url.href, { waitUntil: 'networkidle2' });

        const extractedStyles = await AEMBulk.Puppeteer.CSS.getMinimalCSSForAEMBoilerplateFromCurrentPage(page, { logger: getLogger('frk-bulk-shared/css/extractMinimalCSS') });

        /**
         * following code uses AST for parsing and updating the CSS
         */

        /*
        // read css file
        const css = fs.readFileSync(cssStylesFile, 'utf8');

        // simple parsing with no options
        const ast = csstree.parse(css, {
          positions: true,
        });

        const bodyfontFamilyDeclaration = csstree.find(
          ast,
          (node) => node.type === 'Declaration' && node.property === '--body-font-family',
        );
        if (bodyfontFamilyDeclaration) {
          bodyfontFamilyDeclaration.value = csstree.parse(extractedStyles.bodyFontFamilySet);
        }

        const headingfontFamilyDeclaration = csstree.find(
          ast,
          (node) => node.type === 'Declaration' && node.property === '--heading-font-family',
        );
        if (headingfontFamilyDeclaration) {
          headingfontFamilyDeclaration.value = csstree.parse(extractedStyles.headingFontFamilySet);
        }

        csstree.walk(ast, {
          enter: function e(node, item, list) {
            if (
              node.type === 'Declaration'
              && (
                node.property.startsWith('--body-font-size-')
                || node.property.startsWith('--heading-font-size-')
              )
            ) {
              const sizeLabel = node.property.split('-').pop();
              if (!this.atrule && this.rule) {
                console.log(node);
                console.log("=============================================================");
                node.value = csstree.parse(extractedStyles.headingFontSizes[sizeLabel].mobile);
              } else if (this.atrule && this.rule) {
                console.log(node);
                console.log("=============================================================");
                node.value = csstree.parse(extractedStyles.headingFontSizes[sizeLabel].desktop);
              }
            }

            // remove default fallback fonts
            if (node.type === 'Atrule' && node.name === 'font-face') {
              const nff = csstree.parse(`
  @font-face {
    font-family: qwer-asdf-fallback;
    size-adjust: 66.6%;
    src: local('Arial');
  }
                `);

              // console.log(nff);
              console.log(JSON.stringify(csstree.toPlainObject(nff.children.first), null, 2));
              // ast.children.push(nff);
              // list.insert(csstree.List.createItem(csstree.toPlainObject(nff.children.first)));
              // list.insert(csstree.List.createItem({
              //   type: 'Raw',
              //   value: '\n',
              // }));
              list.remove(item);
            }
          },
        });

        ast.children.push(csstree.parse(`
  @font-face {
    font-family: qwer-asdf-fallback;
    size-adjust: 66.6%;
    src: local('Arial');
  }
                `).children.first);

        // walk the tree
        console.log(JSON.stringify(csstree.toPlainObject(ast), null, 2));

        const cssRaw = csstree.generate(ast);
        const cssFinal2 = beautify.css(cssRaw, {
          indent_size: 2,
          // space_before_conditional: true,
          // jslint_happy: true,
          max_char: 0,
        });
        const cssFinal = cssbeautify(cssFinal2, {
          indent: '  ',
          autosemicolon: false,
        });
        console.log(cssFinal);

        // await AEMBulk.Puppeteer.smartScroll(page, { postReset: true });

        // await AEMBulk.Time.sleep(2000);

        console.log(extractedStyles);
        if (extractedStyles.string) {
          fs.writeFileSync(argv.cssFile, extractedStyles.string);
          logger.info(`Minimal CSS saved to ${argv.cssFile}`);
        }
        */
      } catch (e) {
        logger.error(`minimal css error: ${e.message} ${e.stack}`);
      } finally {
        if (browser) {
          await browser.close();
        }
      }
    }),
  };
}
