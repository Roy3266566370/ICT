import test from 'node:test';
import assert from 'node:assert/strict';
import { MANUAL_408_SUBJECTS, manual408TypeCount } from './manual408.ts';

const EXPECTED_KINDS: Record<string, string[]> = {
  algorithm: [
    'analysis', 'array_address', 'btree_ops', 'expression', 'graph_apply', 'graph_repr',
    'list_ops', 'matrix_storage', 'queue_ops', 'recursion', 'search_ops', 'sort_ops',
    'stack_ops', 'string_match', 'tree_forest',
  ],
  computer_organization: [
    'bus_io', 'cache', 'cpu_control', 'data_repr', 'datapath', 'fixed_point', 'floating',
    'instruction', 'memory', 'performance', 'pipeline', 'virtual_memory',
  ],
  operating_system: [
    'banker', 'cpu_schedule', 'deadlock', 'device_mgmt', 'disk_schedule', 'file_alloc',
    'file_dir', 'memory_alloc', 'os_basics', 'page_replace', 'process_thread', 'sync', 'tlb',
  ],
  computer_network: [
    'application', 'architecture', 'error_control', 'ethernet', 'ip', 'mac', 'network_layer',
    'performance', 'physical', 'sliding_window', 'tcp_control', 'transport',
  ],
};

test('manual 408 catalog covers each subject with its own type list', () => {
  assert.deepEqual(
    MANUAL_408_SUBJECTS.map(subject => subject.id),
    ['algorithm', 'computer_organization', 'operating_system', 'computer_network'],
  );
  const counts: Record<string, number> = {};
  const typeIds = new Set<string>();
  for (const subject of MANUAL_408_SUBJECTS) {
    const kinds = new Set<string>();
    counts[subject.id] = manual408TypeCount(subject);
    for (const group of subject.groups) {
      assert.ok(group.label.trim());
      for (const type of group.types) {
        assert.ok(type.id.trim() && !typeIds.has(type.id), `duplicate type id: ${type.id}`);
        typeIds.add(type.id);
        assert.ok(type.label.trim());
        assert.ok(type.hint.trim());
        assert.ok(type.title.trim());
        assert.ok(type.template.trim(), `empty template: ${type.id}`);
        kinds.add(type.kind);
      }
    }
    assert.deepEqual([...kinds].sort(), [...EXPECTED_KINDS[subject.id]!].sort());
  }
  assert.deepEqual(counts, {
    algorithm: 18,
    computer_organization: 12,
    operating_system: 13,
    computer_network: 17,
  });
});
