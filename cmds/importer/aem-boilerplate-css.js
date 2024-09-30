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
import * as csstree from 'css-tree';
import cssbeautify from 'cssbeautify';
import beautify from 'simply-beautiful';
import path from 'path';
import { CommonCommandHandler, withCustomCLIParameters } from '../../src/cli.js';

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
          devTools: false,
        });

        await page.goto(url.href, { waitUntil: 'networkidle2' });

        const extractedStyles = await
        AEMBulk.Puppeteer.CSS.getMinimalCSSForAEMBoilerplateFromCurrentPage(
          page,
        );

        /**
         * following code uses AST for parsing and updating the CSS
         */

        // read css file
        const css = fs.readFileSync(cssStylesFile, 'utf8');
        const cssWithComments = css.replace(/\/\*/g, '/*!');

        // simple parsing with no options
        const ast = csstree.parse(cssWithComments, {
          positions: true,
        });

        const bodyfontFamilyDeclaration = csstree.find(
          ast,
          (node) => node.type === 'Declaration' && node.property === '--body-font-family',
        );
        if (bodyfontFamilyDeclaration) {
          bodyfontFamilyDeclaration.value = csstree.parse(extractedStyles.bodyFontFamilySet
            .split(',')
            .map((f) => `${f.replace(/"/g, '').replace(/'/g, '').trim().replace(/[^a-z0-9]/gi, '-')}`)
            .flatMap((f) => {
              const fallback = extractedStyles.fontFBFaces.find((fb) => `${fb.fontFamily.replace(/[^a-z0-9]/gi, '-')}` === f);
              return fallback ? [`${f.toLowerCase()}`, `${fallback.fontFamily.toLowerCase()}-fallback`] : [`${f.toLowerCase()}`];
            }).join(','));
        }

        const headingfontFamilyDeclaration = csstree.find(
          ast,
          (node) => node.type === 'Declaration' && node.property === '--heading-font-family',
        );
        if (headingfontFamilyDeclaration) {
          headingfontFamilyDeclaration.value = csstree.parse(extractedStyles.headingFontFamilySet
            .split(',')
            .map((f) => `${f.replace(/"/g, '').replace(/'/g, '').trim().replace(/[^a-z0-9]/gi, '-')}`)
            .flatMap((f) => {
              const fallback = extractedStyles.fontFBFaces.find((fb) => `${fb.fontFamily.replace(/[^a-z0-9]/gi, '-')}` === f);
              return fallback ? [`${f.toLowerCase()}`, `${fallback.fontFamily.toLowerCase()}-fallback`] : [`${f.toLowerCase()}`];
            }).join(','));
        }

        let fontsFound = false;
        csstree.walk(ast, {
          enter: (node, item, list) => {
            if (
              node.type === 'Declaration'
              && (
                node.property.startsWith('--body-font-size-')
                || node.property.startsWith('--heading-font-size-')
              )
            ) {
              const sizeLabel = node.property.split('-').pop();
              if (!this.atrule && this.rule) {
                // eslint-disable-next-line no-param-reassign
                node.value = csstree.parse(extractedStyles.headingFontSizes[sizeLabel].mobile);
              } else if (this.atrule && this.rule) {
                // eslint-disable-next-line no-param-reassign
                node.value = csstree.parse(extractedStyles.headingFontSizes[sizeLabel].desktop);
              }
            }
            // remove default fallback fonts
            if (node.type === 'Atrule' && node.name === 'font-face') {
              if (!fontsFound) {
                fontsFound = true;

                extractedStyles.fontFBFaces.forEach((fb) => {
                  const newNode = csstree.parse(`@font-face {
                    font-family: ${fb.fontFamily.toLowerCase()}-fallback;
                    font-style: ${fb.fontStyle};
                    font-weight: ${fb.fontWeight};
                    src: local('${fb.fallbackFont}');
                    ascent-override: ${fb.ascentOverride};
                    descent-override: ${fb.descentOverride};
                    line-gap-override: ${fb.lineGapOverride};
                    size-adjust: ${fb.sizeAdjust};
                  }
                  `).children.first;
                  list.insertData(newNode, item);
                });
              }
              list.remove(item);
            }
          },
        });

        if (!fontsFound) {
          extractedStyles.fontFBFaces.forEach((fb) => {
            const newNode = csstree.parse(`@font-face {
              font-family: ${fb.fontFamily.toLowerCase()}-fallback;
              font-style: ${fb.fontStyle};
              font-weight: ${fb.fontWeight};
              src: local('${fb.fallbackFont}');
              ascent-override: ${fb.ascentOverride};
              descent-override: ${fb.descentOverride};
              line-gap-override: ${fb.lineGapOverride};
              size-adjust: ${fb.sizeAdjust};
            }
            `).children.first;
            ast.children.push(newNode);
          });
        }

        const cssRaw = csstree.generate(ast);
        const cssFinal2 = beautify.css(cssRaw, {
          indent_size: 2,
          max_char: 0,
        });
        const cssFinal = cssbeautify(cssFinal2, {
          indent: '  ',
          autosemicolon: true,
        });
        extractedStyles.fontFaces.forEach((font) => {
          console.log(`
@font-face {
  font-family: ${font.fontFamily.replace(/[^a-z0-9]/gi, '-').toLowerCase()};
  src: ${font.src};
  font-weight: ${font.fontWeight};
  font-style: ${font.fontStyle};
  font-display: swap;
  unicode-range: ${font.unicodeRange};
}
`);
        });
        fs.writeFileSync(cssStylesFile, cssFinal.replace(/\/\*!/g, '\n/*'));
        fs.writeFileSync(cssFontsFile, extractedStyles.fontFaces.map(
          (font) => `
@font-face {
  font-family: ${font.fontFamily.replace(/[^a-z0-9]/gi, '-').toLowerCase()};
  src: ${font.src};
  font-weight: ${font.fontWeight};
  font-style: ${font.fontStyle};
  font-display: swap;
  unicode-range: ${font.unicodeRange};
}
`,
        ).join(''));
        extractedStyles.fontFaces.forEach((font) => {
          const fileName = path.basename(font.location);
          const fontFile = path.join(fontsFolder, fileName);
          if (!fs.existsSync(fontFile)) {
            fs.copyFileSync(font.location, fontFile);
          }
        });

        logger.info(`Minimal CSS saved to ${cssStylesFile} and fonts to ${fontsFolder}`);
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
