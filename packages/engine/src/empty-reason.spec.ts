import { classifyEmptyReason, ScheduleResolution } from './empty-reason';

function res(partial: Partial<ScheduleResolution>): ScheduleResolution {
  return {
    referencedScheduleId: null,
    referencedScheduleExists: false,
    fallbackScheduleExists: false,
    ruleCount: 0,
    ...partial,
  };
}

describe('classifyEmptyReason', () => {
  it('flags a dangling schedule reference with no working fallback', () => {
    expect(
      classifyEmptyReason(res({ referencedScheduleId: 'gone', fallbackScheduleExists: false })),
    ).toBe('SCHEDULE_MISSING');
  });

  it('flags a host with no schedule anywhere', () => {
    expect(classifyEmptyReason(res({}))).toBe('NO_SCHEDULE');
  });

  it('flags a resolved schedule that has zero availability rules', () => {
    expect(
      classifyEmptyReason(res({ referencedScheduleId: 's1', referencedScheduleExists: true })),
    ).toBe('NO_HOURS');
    expect(classifyEmptyReason(res({ fallbackScheduleExists: true }))).toBe('NO_HOURS');
  });

  it('dangling reference that lands on a fallback with rules is not a config error', () => {
    expect(
      classifyEmptyReason(
        res({ referencedScheduleId: 'gone', fallbackScheduleExists: true, ruleCount: 3 }),
      ),
    ).toBeNull();
  });

  it('dangling reference whose fallback has no rules reports the missing hours', () => {
    expect(
      classifyEmptyReason(res({ referencedScheduleId: 'gone', fallbackScheduleExists: true })),
    ).toBe('NO_HOURS');
  });

  it('sound configuration returns null — emptiness is then genuine', () => {
    expect(
      classifyEmptyReason(
        res({ referencedScheduleId: 's1', referencedScheduleExists: true, ruleCount: 5 }),
      ),
    ).toBeNull();
  });
});
