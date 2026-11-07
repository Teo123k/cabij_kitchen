"""Offline shadow of engine v3 scheduling. No approval, persistence or model calls."""
from __future__ import annotations

from copy import deepcopy
from datetime import date
from decimal import Decimal, localcontext
import json
import math
import re
import sys

from worker.arithmetic import UNITS, number, positive, serialize

ENGINE_VERSION = 'python-scheduling-shadow-v1'
REFERENCE_ENGINE_VERSION = 3
NAN = float('nan')


def minutes(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9]{2}:[0-9]{2}', value):
        return NAN
    hour, minute = map(int, value.split(':'))
    return hour * 60 + minute if hour < 24 and minute < 60 else NAN


def date_number(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', value):
        return NAN
    try:
        return date.fromisoformat(value).toordinal()
    except ValueError:
        return NAN


def clock(value):
    if not math.isfinite(value):
        return 'NaN:NaN'
    local = value % 1440
    return f'{math.floor(local / 60):02d}:{text(local % 60).zfill(2)}'


def text(value):
    if value is None:
        return 'null'
    if value is True:
        return 'true'
    if value is False:
        return 'false'
    if isinstance(value, (Decimal, float)) and value == int(value):
        return str(int(value))
    return str(value)


def priority(value):
    value = str(value or '').lower()
    return value if value in ('urgent', 'high', 'normal') else 'normal'


def working_days(project):
    service = dict(date=project['serviceDate'], startTime=project['startTime'], endTime=project['serviceTime'], staff=project['staff'], equipment=project['equipment'])
    rows = [d for d in project.get('prepDays', []) if d['date'] < project['serviceDate']] + [service]
    days, seen = [], set()
    for row in rows:
        key = row['date']
        if key in seen:
            continue
        seen.add(key)
        if not math.isfinite(date_number(key)) or key > project['serviceDate']:
            continue
        days.append({**deepcopy(row), 'offset': (date_number(key) - date_number(project['serviceDate'])) * 1440,
                     'staff': row.get('staff') if row.get('staff') is not None else project['staff'],
                     'equipment': row.get('equipment') if row.get('equipment') is not None else project['equipment']})
    return sorted(days, key=lambda d: d['date'])


def priority_task_order(tasks):
    ranks = {t['id']: {'urgent': 2, 'high': 1, 'normal': 0}[priority(t.get('priority'))] for t in tasks}
    by_id = {t['id']: t for t in tasks}

    def promote(identifier, rank, seen):
        if identifier in seen or identifier not in by_id:
            return
        seen.add(identifier)
        ranks[identifier] = max(ranks[identifier], rank)
        for dependency in by_id[identifier]['dependencies']:
            promote(dependency, rank, seen)

    for task in tasks:
        promote(task['id'], {'urgent': 2, 'high': 1, 'normal': 0}[priority(task.get('priority'))], set())
    pending, done, ordered = list(tasks), set(), []
    while pending:
        ready = [t for t in pending if all(d in done or d not in by_id for d in t['dependencies'])]
        next_task = sorted(ready, key=lambda t: -ranks[t['id']])[0] if ready else pending[0]
        ordered.append(next_task)
        done.add(next_task['id'])
        pending.remove(next_task)
    return ordered


def overlap(a, b, c, d):
    return a < b and c < d and a < d and c < b


def scalar(row, key):
    return float(number(row[key])) if key in row else NAN


def integer(value):
    return math.isfinite(value) and value == math.floor(value)


def staff_invalid(person):
    return (not person.get('name') or not person.get('roles') or not minutes(person.get('start')) < minutes(person.get('end'))
            or ((person.get('breakStart') or person.get('breakEnd')) and not minutes(person.get('breakStart')) < minutes(person.get('breakEnd'))))


def round_quantity(value):
    return math.floor((value + sys.float_info.epsilon) * 1000000 + 0.5) / 1000000


def scheduling_demand(project, versions, client_id):
    # Batch counts and evidence preserve JS binary64 order, unlike decimal costing.
    approved = {v['id']: v for v in versions if v['client_id'] == client_id and v['status'] == 'approved'}
    pinned, demand = {}, {}

    def visit(identifier, quantity, unit, stack=()):
        row = approved.get(identifier)
        if not row or identifier in stack:
            return
        recipe = row['recipe_json']
        source_yield = recipe.get('yield') or {}
        target_unit = source_yield.get('unit')
        if (not positive(source_yield.get('quantity')) or unit not in UNITS or target_unit not in UNITS
                or UNITS[unit][0] != UNITS[target_unit][0] or not math.isfinite(quantity)):
            return
        scale = quantity * UNITS[unit][1] / UNITS[target_unit][1] / scalar(source_yield, 'quantity')
        if not 0 < scale <= 500 or len(stack) > 20:
            return
        pinned[identifier] = row
        demand[identifier] = demand.get(identifier, 0) + scale
        for ingredient in recipe.get('ingredients') or []:
            if ingredient.get('recipe_version_id'):
                visit(ingredient['recipe_version_id'], scalar(ingredient, 'quantity') * scale, ingredient.get('unit'), (*stack, identifier))

    for item in project['menu']:
        visit(item['versionId'], scalar(item, 'quantity'), item.get('unit'))
    targets = [dict(id=identifier, scale=scale, quantity=round_quantity(scale * scalar(pinned[identifier]['recipe_json']['yield'], 'quantity'))) for identifier, scale in demand.items()]
    return pinned, demand, targets


def scheduling_plan(project, versions, client_id):
    pinned, demand, targets = scheduling_demand(project, versions, client_id)
    days, tasks, recipe_ends, exceptions = working_days(project), [], {}, []

    def add(code, problem, evidence):
        exceptions.append(dict(code=code, problem=problem, evidence=evidence, severity='blocker'))

    for person in project['staff']:
        if staff_invalid(person):
            add('STAFF REVIEW REQUIRED', 'Check staff name, roles, shift and complete break interval.', person.get('name') or person['id'])

    def make_tasks(identifier, stack=()):
        if identifier in recipe_ends or identifier in stack or identifier not in pinned:
            return
        recipe = pinned[identifier]['recipe_json']
        scale = demand[identifier]
        children = [i['recipe_version_id'] for i in recipe.get('ingredients', []) if i.get('recipe_version_id')]
        for child in children:
            make_tasks(child, (*stack, identifier))
        steps = recipe.get('production_steps') or []
        if not steps:
            add('TASKS REQUIRED', f"Enter production steps for {recipe['title']}.", identifier)
        ends = []
        for batch in range(min(500, math.ceil(scale))):
            previous = [end for child in children for end in recipe_ends.get(child, [])]
            for index, step in enumerate(steps):
                task_id = f'{identifier}:{batch}:{index}'
                override = project['overrides'].get(task_id, {})
                task = {**deepcopy(step), 'id': task_id, 'versionId': identifier, 'recipeName': recipe['title'], 'batch': batch + 1,
                        'quantity': round_quantity(min(1, scale - batch) * scalar(recipe['yield'], 'quantity')), 'unit': recipe['yield']['unit'],
                        'dependencies': previous, **deepcopy(override), 'sourceStepIndex': index, 'sourceEquipmentId': step.get('equipmentId') or None,
                        'prepDate': override.get('prepDate') or project['serviceDate'], 'priority': priority(override.get('priority') or step.get('priority'))}
                active, passive = scalar(task, 'active'), scalar(task, 'passive')
                if (not step.get('reviewed') or task.get('active') in ('', None) or task.get('passive') in ('', None)
                        or not integer(active) or not integer(passive) or active < 0 or passive < 0 or active + passive <= 0
                        or not task.get('description') or not task.get('role')):
                    add('DURATION REVIEW REQUIRED', f"Review timing, role and description for {recipe['title']}, step {index + 1}.", task_id)
                tasks.append(task)
                previous = [task_id]
            ends.extend(previous)
        recipe_ends[identifier] = ends

    for identifier in demand:
        make_tasks(identifier)
    if len(tasks) > 500:
        add('PLAN LIMIT', 'Split this event: the first planner supports up to 500 tasks.', 'Task library')
    schedule, unscheduled = [], []
    for task in priority_task_order(tasks[:500]):
        def fail(reason, placement=None):
            unscheduled.append({**task, **({'placement': placement} if placement is not None else {}), 'reason': reason})
        day = next((d for d in days if d['date'] == task['prepDate']), None)
        if not day or not minutes(day.get('startTime')) < minutes(day.get('endTime')):
            fail('Choose a configured prep day with a valid working window.')
            continue
        offset = day['offset']
        if task['prepDate'] < project['serviceDate'] and (not task.get('advance_reviewed') or not (task.get('advance_source') or '').strip()):
            fail('Advance prep needs a reviewed storage, holding and handover reference before scheduling.')
            continue
        if any(staff_invalid(s) for s in day['staff']):
            add('STAFF REVIEW REQUIRED', f"Check dated staff availability on {day['date']}.", day['date'])
        dependencies = [next((a for a in schedule if a['id'] == identifier), None) for identifier in task['dependencies']]
        if any(d is None for d in dependencies):
            fail('An upstream task could not be scheduled.')
            continue
        active, passive = scalar(task, 'active'), scalar(task, 'passive')
        duration = active + passive
        if not integer(duration) or duration <= 0 or active < 0 or passive < 0:
            fail('Reviewed duration required.')
            continue
        equipment = next((e for e in day['equipment'] if e['id'] == task.get('equipmentId')), None) if task.get('equipmentId') else None
        if task.get('equipmentId') and (not equipment or not positive(task.get('capacity')) or not positive(equipment.get('capacity')) or number(task['capacity']) > number(equipment['capacity'])):
            fail('Equipment missing or batch capacity exceeds equipment capacity.')
            continue
        day_start, day_end = offset + minutes(day['startTime']), offset + minutes(day['endTime'])
        starts = [day_start, *[d['end'] for d in dependencies], offset + minutes(task['earliest']) if task.get('earliest') else day_start]
        ends = [minutes(project['serviceTime']), day_end, offset + minutes(task['latest']) if task.get('latest') else day_end]
        earliest = max(starts) if all(math.isfinite(x) for x in starts) else NAN
        latest = min(ends) if all(math.isfinite(x) for x in ends) else NAN
        rejected = dict(staff=0, equipmentHours=0, equipmentCapacity=0)
        placement = dict(earliest=earliest, latest=latest, dependencyEnds=[dict(id=d['id'], end=d['end']) for d in dependencies], rejectedCandidates=rejected)
        allocation, start = None, earliest
        while start + duration <= latest and allocation is None:
            chef = next((s for s in day['staff'] if (not task.get('assignee') or task['assignee'] == s['id'])
                         and task.get('role') in [v.strip() for v in (s.get('roles') or '').split(',')]
                         and start >= offset + minutes(s.get('start')) and start + active <= offset + minutes(s.get('end'))
                         and not (s.get('breakStart') and s.get('breakEnd') and overlap(start, start + active, offset + minutes(s['breakStart']), offset + minutes(s['breakEnd'])))
                         and not any(a['chefId'] == s['id'] and overlap(start, start + active, a['start'], a['activeEnd']) for a in schedule)), None)
            if chef is None:
                rejected['staff'] += 1
            elif equipment and (start < offset + minutes(equipment.get('start')) or start + duration > offset + minutes(equipment.get('end'))):
                rejected['equipmentHours'] += 1
            elif equipment and any(sum(scalar(a, 'capacity') for a in schedule if a.get('equipmentId') == equipment['id'] and a['start'] <= minute < a['end']) + scalar(task, 'capacity') > scalar(equipment, 'capacity') for minute in range(int(start), int(start + duration))):
                rejected['equipmentCapacity'] += 1
            else:
                allocation = {**task, 'chefId': chef['id'], 'chefName': chef['name'], 'start': start, 'activeEnd': start + active, 'end': start + duration, 'placement': placement}
            start += 1
        if allocation:
            schedule.append(allocation)
        else:
            fail('No slot found within staff skills, shifts, breaks, equipment and deadline. Reassign, add time/resources or revise reviewed batch steps.', placement)
    for task in unscheduled:
        add('NO FEASIBLE PLAN FOUND', f"{task['recipeName']}: {task.get('description', 'undefined')}. {task['reason']}", task['id'])
    plan = dict(engineVersion=3, project=project, clientId=client_id, recipes=list(pinned.values()), recipeTargets=targets,
                workDays=days, tasks=tasks, schedule=schedule, unscheduled=unscheduled)
    return dict(workDays=days, tasks=tasks, schedule=schedule, unscheduled=unscheduled, exceptions=exceptions, evidence=schedule_evidence(plan))


def schedule_evidence(plan):
    project, rows, tasks = plan['project'], plan['schedule'], plan['tasks']
    days = plan['workDays']
    by_id = {t['id']: t for t in rows}
    recipes = {r['id']: r for r in plan['recipes']}
    targets = {t['id']: t for t in plan['recipeTargets']}

    def day_for(task):
        return next((d for d in days if d['date'] == (task.get('prepDate') or project['serviceDate'])), None)

    def window_valid(task):
        day = day_for(task)
        return bool(math.isfinite(task['start']) and day and task['start'] >= day['offset'] + minutes(day['startTime']) and task['end'] <= day['offset'] + minutes(day['endTime']) and task['end'] <= minutes(project['serviceTime']))

    def duration_valid(task):
        source = next((t for t in tasks if t['id'] == task['id']), None)
        offset = (day_for(task) or {}).get('offset', 0)
        return bool(source and task['activeEnd'] - task['start'] == scalar(source, 'active') and task['end'] - task['start'] == scalar(source, 'active') + scalar(source, 'passive')
                    and (not source.get('earliest') or task['start'] >= offset + minutes(source['earliest']))
                    and (not source.get('latest') or task['end'] <= offset + minutes(source['latest'])))

    def staff_valid(task):
        day = day_for(task)
        person = next((s for s in day['staff'] if s['id'] == task['chefId']), None) if day else None
        offset = day['offset'] if day else 0
        return bool(person and task.get('role') in [r.strip() for r in (person.get('roles') or '').split(',')]
                    and task['start'] >= offset + minutes(person.get('start')) and task['activeEnd'] <= offset + minutes(person.get('end'))
                    and not (person.get('breakStart') and person.get('breakEnd') and overlap(task['start'], task['activeEnd'], offset + minutes(person['breakStart']), offset + minutes(person['breakEnd']))))

    equipment_valid = True
    for task in rows:
        if not task.get('equipmentId'):
            continue
        day = day_for(task)
        equipment = next((e for e in day['equipment'] if e['id'] == task['equipmentId']), None) if day else None
        if not (equipment and task['start'] >= day['offset'] + minutes(equipment.get('start')) and task['end'] <= day['offset'] + minutes(equipment.get('end')) and scalar(task, 'capacity') > 0):
            equipment_valid = False
    for day in days:
        for equipment in day['equipment']:
            events = [(t['start'], scalar(t, 'capacity')) for t in rows if t.get('equipmentId') == equipment['id'] and (t.get('prepDate') or project['serviceDate']) == day['date']]
            events += [(t['end'], -scalar(t, 'capacity')) for t in rows if t.get('equipmentId') == equipment['id'] and (t.get('prepDate') or project['serviceDate']) == day['date']]
            used = 0
            for _, delta in sorted(events, key=lambda e: (e[0], e[1])):
                used += delta
                if not used <= scalar(equipment, 'capacity'):
                    equipment_valid = False
    checks = []

    def check(name, passed, detail):
        checks.append(dict(name=name, passed=bool(passed) if rows else None, detail=detail))

    check('Every task allocated once', tasks and not plan['unscheduled'] and len(rows) == len(tasks) and len(by_id) == len(rows) and all(t['id'] in by_id for t in tasks), f"{len(rows)} allocated / {len(tasks)} required; {len(plan['unscheduled'])} unscheduled.")
    check('Service window', all(window_valid(t) for t in rows), f"Configured dated working windows; service-day deadline {project['serviceTime']} ({project.get('timeZone') or 'Europe/London'}).")
    check('Task durations & time restrictions', all(duration_valid(t) for t in rows), 'Allocated active and total time must match the task inputs and any step-specific window.')
    check('Approved recipe sources', tasks and all(t['versionId'] in recipes and recipes[t['versionId']]['status'] == 'approved' and recipes[t['versionId']]['client_id'] == plan['clientId'] and recipes[t['versionId']]['recipe_json'].get('source_evidence_ids') for t in tasks), 'Tasks must point to approved recipe versions from this kitchen, with source references.')
    check('Recipe order & dependencies', all(all(d in by_id and by_id[d]['end'] <= t['start'] for d in t['dependencies']) for t in rows), 'Each predecessor must finish before its dependent task starts.')
    check('Staff roles, shifts & breaks', all(staff_valid(t) for t in rows), 'The named person must cover the required role and active work interval, outside their recorded break.')
    check('No overlapping active work', all(a is b or a['chefId'] != b['chefId'] or not overlap(a['start'], a['activeEnd'], b['start'], b['activeEnd']) for a in rows for b in rows), 'Passive cooking time releases the chef; active work cannot overlap.')
    check('Advance prep reviewed', all(not t.get('prepDate') or t['prepDate'] == project['serviceDate'] or (t.get('advance_reviewed') and (t.get('advance_source') or '').strip()) for t in tasks), 'Every advance-prep task needs a chef-reviewed storage, holding and handover reference. This does not independently validate food safety.')
    check('Equipment availability & capacity', equipment_valid, 'Equipment remains occupied for active plus passive time; summed batch slots must fit.')
    check('Reviewed timing inputs', tasks and all(t.get('reviewed') and t.get('active') not in ('', None) and t.get('passive') not in ('', None) and integer(scalar(t, 'active')) and integer(scalar(t, 'passive')) and scalar(t, 'active') >= 0 and scalar(t, 'passive') >= 0 and scalar(t, 'active') + scalar(t, 'passive') > 0 for t in tasks), 'Chef review of duration is recorded separately from evidence of measurement.')
    evidence_tasks = []
    for task in tasks:
        allocation, record = by_id.get(task['id']), recipes[task['versionId']]
        recipe, target = record['recipe_json'], targets[task['versionId']]
        source_step = recipe['production_steps'][task['sourceStepIndex']]
        timing_source = (source_step.get('timing_source') or '').strip()
        unscheduled = next((t for t in plan['unscheduled'] if t['id'] == task['id']), {})
        trace = (allocation or unscheduled).get('placement')
        advance = f"Advance prep reference: {task.get('advance_source') or 'missing'}." if task.get('prepDate') and task['prepDate'] < project['serviceDate'] else ''
        if trace:
            rejected = trace['rejectedCandidates']
            reason = f"Search window {clock(trace['earliest'])}–{clock(trace['latest'])}. Earlier candidate starts rejected: staff {rejected['staff']}, equipment hours {rejected['equipmentHours']}, equipment capacity {rejected['equipmentCapacity']}."
        else:
            reason = 'Candidate-start trace was not recorded in this saved plan.'
        equipment = next((e for e in project['equipment'] if e['id'] == task.get('equipmentId')), {})
        row = dict(id=task['id'], title=f"{task['recipeName']} · {task.get('description', 'undefined')} · batch {task['batch']}", version=task['versionId'],
                   step=task['sourceStepIndex'] + 1, sources=recipe.get('source_evidence_ids') or [],
                   batch=f"{text(target['quantity'])} {recipe['yield']['unit']} target ÷ {text(recipe['yield']['quantity'])} {recipe['yield']['unit']} source batch = {text(target['scale'])}×; {math.ceil(target['scale'])} batches. This batch: {text(task['quantity'])} {task['unit']}.",
                   timing=f"{text(task.get('active', 'undefined'))} min active + {text(task.get('passive', 'undefined'))} min passive. Full duration retained for partial batches. Priority: {task.get('priority') or 'normal'}. {advance}",
                   timingSource=timing_source or 'No timing source recorded', timingBasis=source_step.get('timing_basis') or 'Not recorded', timingEvidencePresent=bool(timing_source), dependencies=task['dependencies'],
                   allocation=f"{task.get('prepDate') or project['serviceDate']} · {clock(allocation['start'])}–{clock(allocation['end'])}; {allocation['chefName']}; active work ends {clock(allocation['activeEnd'])}." if allocation else 'Unscheduled',
                   equipment=f"{equipment.get('name') or task['equipmentId']}; {text(task.get('capacity', 'undefined'))} slots occupied" if task.get('equipmentId') else 'No equipment assigned', reason=reason,
                   override='Person selected by operator; role and availability checks still apply.' if project['overrides'].get(task['id'], {}).get('assignee') else 'First available eligible person in the recorded staff order.')
        if 'version_number' in record:
            row['versionNumber'] = record['version_number']
        evidence_tasks.append(row)
    return dict(engineVersion=3, checks=checks, tasks=evidence_tasks, missingTimingEvidence=sum(not t['timingEvidencePresent'] for t in evidence_tasks),
                method='Tasks use explicit prep dates and dated shifts. Urgent and high-priority work pulls its prerequisites forward; dependencies remain mandatory. Each task takes the first feasible whole-minute start and first eligible person in the dated staff order. Priority cannot override handling review, skills, shifts, capacity or deadlines. This is a greedy planner, not a global optimisation.',
                limits='These checks validate the recorded inputs and allocations. They do not establish food-safety compliance, verify source documents, measure real cooking time, or prove that a better schedule does not exist. Automatic cooling/holding validation, overnight tasks, off-site travel and unrecorded cleanup are outside this planner. Other projects are planned separately; combined-calendar resource alerts need review.')


def finite_json(value):
    # JSON.stringify turns non-finite reference trace fields into null.
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, list):
        return [finite_json(v) for v in value]
    if isinstance(value, dict):
        return {k: finite_json(v) for k, v in value.items()}
    return value


def run(request):
    if request.get('schemaVersion') != 1:
        raise ValueError('Unsupported scheduling request schemaVersion; expected 1.')
    with localcontext() as context:
        context.prec = 50
        result = scheduling_plan(request['project'], request['versions'], request['clientId'])
        return finite_json(dict(engineVersion=ENGINE_VERSION, referenceEngineVersion=REFERENCE_ENGINE_VERSION, mode='shadow', scheduling=result))


def main():
    raw = sys.stdin.buffer.read(4 * 1024 * 1024 + 1)
    try:
        if len(raw) > 4 * 1024 * 1024:
            raise ValueError('Scheduling request exceeds 4 MiB.')
        request = json.loads(raw, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Non-finite JSON is not supported.')))
        print(json.dumps(run(request), default=serialize, allow_nan=False, ensure_ascii=False))
    except (ValueError, TypeError, KeyError, AttributeError, OverflowError) as error:
        print(json.dumps(dict(engineVersion=ENGINE_VERSION, mode='shadow', error=str(error))))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
