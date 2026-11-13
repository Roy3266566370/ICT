import test from 'node:test';
import assert from 'node:assert/strict';
import { compileExpression } from './expr.ts';
import { computeLab } from './compute.ts';
import type { LabModel, LabProblem } from './types.ts';

function question(model: Partial<LabModel>): LabProblem {
  return {
    subject:'calculus', model:{subject:'calculus',engine:'antiderivative_v1',defaults:{c:0},params:[],...model},
    solution:{answer:'F(x)=(x^2+1)*atan(x)/2-x/2+C',summary:'',steps:[]},
  } as LabProblem;
}

test('canonical inverse functions match backend values and real domains', () => {
  for (const [source, expected] of [
    ['atan(1)', Math.PI/4], ['arctan(1)', Math.PI/4],
    ['acot(1)', Math.PI/4], ['arccot(1)',Math.PI/4],
    ['asec(2)',Math.PI/3],['arcsec(2)',Math.PI/3],
    ['acsc(2)',Math.PI/6],['arccsc(2)',Math.PI/6],
  ] as const) assert.ok(Math.abs(compileExpression(source).eval()-expected)<1e-12,source);
  assert.equal(compileExpression('asec(x)').evalOrNull({x:0.5}),null);
});

test('user integral draws the correct antiderivative and constant shifts without changing slope', () => {
  const p=question({kind:'antiderivative',expression:'x*atan(x)',
    antiderivative_expression:'x^2*atan(x)/2-x/2+atan(x)/2',plot_domain:[-3,3]});
  const base=computeLab(p,{c:0}), moved=computeLab(p,{c:2});
  assert.equal(base.subject,'calculus');
  if(base.subject!=='calculus'||moved.subject!=='calculus')return;
  assert.equal(base.kind,'antiderivative');
  assert.ok(base.series.some(p=>p.y!==null));
  assert.equal(base.checks.find(c=>c.id==='derivative')?.status,'pass');
  assert.ok(Math.abs(moved.series[100]!.y!-base.series[100]!.y!-2)<1e-10);
});

test('unparseable integrand cannot silently become a flat zero function', () => {
  assert.throws(()=>computeLab(question({kind:'integral',expression:'not_a_function(x)',
    defaults:{lower:0,upper:1,n:8}}),{lower:0,upper:1,n:8}));
});

test('canonical small and large coefficients preserve signed scientific exponents', () => {
  for (const [source, expected] of [['1.0e-5*x',0.00001],['2.5E+3*x',2500],['.25e-2*x',0.0025]] as const) {
    assert.ok(Math.abs(compileExpression(source).eval({x:1})-expected)<1e-12,source);
  }
  assert.equal(compileExpression('2*e').eval(),2*Math.E);
  assert.throws(()=>compileExpression('1.2.3*x'));
});

test('reversed integral bounds preserve signed sums and original exact value', () => {
  const p = question({ kind:'integral', expression:'x', defaults:{lower:2,upper:0,n:8} });
  p.solution = { answer:'-2', answer_value:-2, convergence:'finite', summary:'', steps:[] };
  const r = computeLab(p, {lower:2,upper:0,n:8});
  assert.equal(r.subject, 'calculus');
  if (r.subject !== 'calculus') return;
  assert.equal(r.exact, -2);
  assert.ok(Math.abs(r.approx! + 2) < 1e-12);
  assert.ok(r.domain.x_min < r.domain.x_max);
});
