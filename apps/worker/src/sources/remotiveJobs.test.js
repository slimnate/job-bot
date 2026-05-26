import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  htmlToPlainText,
  resolveRemotiveFeedUrls,
} from './remotiveRssUtils.ts';

const SAMPLE_ITEM_XML = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Backend Developer</title>
      <jobId>12345</jobId>
      <company>Acme Corp</company>
      <location>Worldwide</location>
      <type>full_time</type>
      <link>https://remotive.com/remote-jobs/software-development/backend-developer-12345</link>
      <pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate>
      <category>Software Development</category>
      <description><![CDATA[<p>Hello <strong>world</strong></p><p>Second line</p>]]></description>
    </item>
  </channel>
</rss>`;

describe('remotiveJobs helpers', () => {
  it('resolveRemotiveFeedUrls uses all-jobs feed when categories empty', () => {
    assert.deepEqual(resolveRemotiveFeedUrls({}), [
      'https://remotive.com/remote-jobs/feed',
    ]);
    assert.deepEqual(resolveRemotiveFeedUrls(undefined), [
      'https://remotive.com/remote-jobs/feed',
    ]);
  });

  it('resolveRemotiveFeedUrls uses category feeds', () => {
    const urls = resolveRemotiveFeedUrls({ categories: 'devops,data' });
    assert.equal(urls.length, 2);
    assert.ok(urls.some((u) => u.includes('/devops/feed')));
    assert.ok(urls.some((u) => u.includes('/data/feed')));
  });

  it('htmlToPlainText strips tags and keeps paragraphs', () => {
    const text = htmlToPlainText('<p>Hello <b>world</b></p><br/><p>Line two</p>');
    assert.ok(text.includes('Hello world'));
    assert.ok(text.includes('Line two'));
  });
});

describe('remotiveJobs RSS parsing', () => {
  it('parses sample item fields via XMLParser path', async () => {
    const { XMLParser } = await import('fast-xml-parser');
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      trimValues: true,
      isArray: (name) => name === 'item',
    });
    const doc = parser.parse(SAMPLE_ITEM_XML);
    const item = doc.rss.channel.item[0];
    assert.equal(item.title, 'Backend Developer');
    assert.equal(String(item.jobId), '12345');
    assert.equal(item.company, 'Acme Corp');
  });
});
