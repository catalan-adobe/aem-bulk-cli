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
import ExcelJS from 'exceljs';

export class ExcelWriter {
  #writer;

  constructor(options = {
    filename: 'report.xlsx',
    sheetName: 'report',
    headers: [],
    formatRowFn: null,
    writeEvery: 1000,
  }) {
    this.filename = options.filename || 'report.xlsx';
    this.headers = options.headers || [];
    this.formatRowFn = options.formatRowFn || null;
    this.writeEvery = options.writeEvery || 1000;

    // init excel workbook
    this.#writer = fs.createWriteStream(this.filename);
    this.workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: this.#writer,
    });
    this.worksheet = this.workbook.addWorksheet(options.sheetName);
    // create Excel auto Filters for the first row / header
    this.worksheet.autoFilter = {
      from: 'A1',
      to: `${String.fromCharCode(65 + this.headers.length - 1)}1`,
    };
    // set headers
    this.worksheet.addRow(this.headers);
  }

  async write() {
    await this.workbook.xlsx.write(this.#writer);
  }

  async close() {
    await this.workbook.commit();
  }

  async addRows(data) {
    let rows = data;

    if (this.formatRowFn) {
      rows = data.map(this.formatRowFn);
    }

    for (let i = 0; i < rows.length; i += this.writeEvery) {
      const r = rows[i];
      this.worksheet.addRow(r).commit();
    }
  }

  async addRow(data) {
    let row = data;

    if (this.formatRowFn) {
      row = this.formatRowFn(data);
    }

    this.worksheet.addRow(row).commit();
  }
}
