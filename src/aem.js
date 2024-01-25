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

const AEM_API_HOST = 'https://admin.hlx.page';

export function buildAPIURL(stage, url) {
  const u = new URL(url);
  const [branch, repo, org] = u.host.split('.')[0].split('--');
  return [AEM_API_HOST, stage, org, repo, branch].join('/') + u.pathname;
}
