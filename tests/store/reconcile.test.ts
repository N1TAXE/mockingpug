import { describe, expect, it } from 'vitest';
import { computeEntityMeta } from '../../src/store/fingerprint.js';
import { findOrphanEntities, isNoopPlan, planReconciliation } from '../../src/store/reconcile.js';
import type { FieldSpec } from '../../src/core/index.js';

const idIncrement: FieldSpec = { kind: 'number', mode: 'increment' };
const nameField: FieldSpec = { kind: 'username', style: 'FS' };
const emailGmail: FieldSpec = { kind: 'email', domain: 'gmail.com' };
const emailCompany: FieldSpec = { kind: 'email', domain: 'company.com' };

describe('planReconciliation : reconciliation scenarios', () => {
  it('1. new entity: no prior snapshot => isNewEntity, every field "added"', () => {
    const current = computeEntityMeta(1000, { id: idIncrement, name: nameField });
    const plan = planReconciliation(undefined, current);
    expect(plan.isNewEntity).toBe(true);
    expect(plan.amountDelta).toBe(1000);
    expect(plan.addedFields.sort()).toEqual(['id', 'name']);
    expect(plan.removedFields).toEqual([]);
    expect(plan.changedFields).toEqual([]);
  });

  it('2. unchanged schema => no-op plan, nothing to regenerate', () => {
    const schema = { id: idIncrement, name: nameField };
    const previous = computeEntityMeta(1000, schema);
    const current = computeEntityMeta(1000, schema);
    const plan = planReconciliation(previous, current);
    expect(isNoopPlan(plan)).toBe(true);
  });

  it('3. amount increased => positive amountDelta, existing fields untouched', () => {
    const schema = { id: idIncrement, name: nameField };
    const previous = computeEntityMeta(1000, schema);
    const current = computeEntityMeta(1200, schema);
    const plan = planReconciliation(previous, current);
    expect(plan.amountDelta).toBe(200);
    expect(plan.addedFields).toEqual([]);
    expect(plan.changedFields).toEqual([]);
  });

  it('4. amount decreased => negative amountDelta', () => {
    const schema = { id: idIncrement, name: nameField };
    const previous = computeEntityMeta(1000, schema);
    const current = computeEntityMeta(700, schema);
    const plan = planReconciliation(previous, current);
    expect(plan.amountDelta).toBe(-300);
  });

  it('5. a field was added => appears only in addedFields, others unchanged', () => {
    const previous = computeEntityMeta(1000, { id: idIncrement });
    const current = computeEntityMeta(1000, { id: idIncrement, name: nameField });
    const plan = planReconciliation(previous, current);
    expect(plan.addedFields).toEqual(['name']);
    expect(plan.unchangedFields).toEqual(['id']);
  });

  it('6. a field was removed => appears only in removedFields', () => {
    const previous = computeEntityMeta(1000, { id: idIncrement, name: nameField });
    const current = computeEntityMeta(1000, { id: idIncrement });
    const plan = planReconciliation(previous, current);
    expect(plan.removedFields).toEqual(['name']);
    expect(plan.unchangedFields).toEqual(['id']);
  });

  it('7. a field\'s type/params changed => regenerate only that field', () => {
    const previous = computeEntityMeta(1000, { id: idIncrement, email: emailGmail });
    const current = computeEntityMeta(1000, { id: idIncrement, email: emailCompany });
    const plan = planReconciliation(previous, current);
    expect(plan.changedFields).toEqual(['email']);
    expect(plan.unchangedFields).toEqual(['id']);
    expect(plan.addedFields).toEqual([]);
    expect(plan.removedFields).toEqual([]);
  });

  it('9. fixtures added => fixturesChanged true, not a no-op', () => {
    const schema = { id: idIncrement };
    const previous = computeEntityMeta(5, schema);
    const current = computeEntityMeta(5, schema, [{ slug: 'vk' }]);
    const plan = planReconciliation(previous, current);
    expect(plan.fixturesChanged).toBe(true);
    expect(isNoopPlan(plan)).toBe(false);
  });

  it('10. fixtures unchanged (including "no fixtures" on both sides) => fixturesChanged false', () => {
    const schema = { id: idIncrement };
    const previous = computeEntityMeta(5, schema, [{ slug: 'vk' }]);
    const current = computeEntityMeta(5, schema, [{ slug: 'vk' }]);
    const plan = planReconciliation(previous, current);
    expect(plan.fixturesChanged).toBe(false);
    expect(isNoopPlan(plan)).toBe(true);
  });

  it('11. a fixture value edited => fixturesChanged true even though field specs and amount are the same', () => {
    const schema = { id: idIncrement };
    const previous = computeEntityMeta(5, schema, [{ slug: 'vk' }]);
    const current = computeEntityMeta(5, schema, [{ slug: 'vkontakte' }]);
    const plan = planReconciliation(previous, current);
    expect(plan.fixturesChanged).toBe(true);
  });

  it('combines multiple simultaneous changes correctly (amount + add + remove + change)', () => {
    const previous = computeEntityMeta(1000, { id: idIncrement, email: emailGmail, legacy: nameField });
    const current = computeEntityMeta(1500, { id: idIncrement, email: emailCompany, bio: nameField });
    const plan = planReconciliation(previous, current);
    expect(plan.amountDelta).toBe(500);
    expect(plan.addedFields).toEqual(['bio']);
    expect(plan.removedFields).toEqual(['legacy']);
    expect(plan.changedFields).toEqual(['email']);
    expect(plan.unchangedFields).toEqual(['id']);
  });
});

describe('8. findOrphanEntities : schema removed from mock/api', () => {
  it('flags entities present in storage but absent from current schemas', () => {
    const orphans = findOrphanEntities(['user', 'blogpost', 'legacy_thing'], ['user', 'blogpost']);
    expect(orphans).toEqual(['legacy_thing']);
  });

  it('returns an empty list when nothing is orphaned', () => {
    expect(findOrphanEntities(['user'], ['user', 'blogpost'])).toEqual([]);
  });
});
