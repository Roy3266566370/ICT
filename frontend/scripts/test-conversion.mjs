import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const directory = mkdtempSync(path.join(tmpdir(), 'xiangsheng-conversion-'));
try {
  execFileSync(process.execPath, [fileURLToPath(new URL('../node_modules/typescript/lib/tsc.js', import.meta.url)),
    'src/ispec/dataset.ts', '--target', 'ES2022', '--module', 'commonjs', '--outDir', directory, '--skipLibCheck', '--strict'], {stdio: 'inherit'});
  const { resolveChartDataset, filterSpecRows, visibleSpecColumns } = require(path.join(directory, 'dataset.js'));
  const source = {page: 2, element_id: 'chart_1', bbox: null, status: 'original', excerpt: 'Sales / Costs'};
  const spec = {spec_version: '1.0', object_id: 'unfamiliar_chart', kind: 'filter',
    parameters: [{id: 'category', label: '分类', type: 'enum', options: ['全部', 'Jan', 'Feb'], default: '全部', source}],
    datasets: [{id: 'chart', columns: ['category', 'series', 'value'],
      rows: [['Jan', 'Sales', 12], ['Feb', 'Sales', 25], ['Jan', 'Costs', 7], ['Feb', 'Costs', 9]]}],
    views: [{type: 'vega', spec_ref: 'bar', dataset: 'chart', x: 'category', y: 'value'}]};
  const evaluation = {values: {category: 'Feb'}, derived: {}, violations: []};
  const chart = resolveChartDataset(spec, evaluation, spec.views[0]);
  assert.deepEqual(chart.rows.map(row => row.value), [25, 9], 'Changing the category must actually filter the plotted values');
  assert.deepEqual(filterSpecRows(spec, evaluation, chart.rows), chart.rows, 'Table and chart use the same filter');
  assert.equal(resolveChartDataset(spec, {...evaluation, values: {category: '全部'}}, spec.views[0]).rows.length, 4);
  assert.equal(spec.datasets[0].rows.length, 4, 'Filtering must not mutate source values');
  assert.deepEqual(visibleSpecColumns(spec, {...evaluation, values: {filter_column: 'series'}}, ['series', 'value']), ['series']);
  assert.deepEqual(visibleSpecColumns(spec, {...evaluation, values: {filter_column: '全部'}}, ['series', 'value']), ['series', 'value']);
  console.log('PASS: chart/table category filtering, reset, and immutable source data');
} finally {
  assert.equal(path.dirname(directory), path.resolve(tmpdir()));
  assert.ok(path.basename(directory).startsWith('xiangsheng-conversion-'));
  rmSync(directory, {recursive: true, force: true});
}
