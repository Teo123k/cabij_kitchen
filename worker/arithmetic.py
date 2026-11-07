"""Decimal arithmetic shadow of operations engine v3; never an approval service."""
from __future__ import annotations

import json
import math
import sys
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_FLOOR, ROUND_HALF_UP, localcontext

ENGINE_VERSION = "python-arithmetic-shadow-v1"
REFERENCE_ENGINE_VERSION = 3
UNITS = {"g": ("mass", 1), "kg": ("mass", 1000), "ml": ("volume", 1),
         "l": ("volume", 1000), "each": ("count", 1), "pcs": ("count", 1),
         "portion": ("portion", 1)}
BASE = {"mass": "g", "volume": "ml", "count": "each", "portion": "portion"}
D = Decimal
EPSILON = D("2.220446049250313e-16")


def number(value):
    # Match existing Number coercion for persisted scalar fields, including blank/zero.
    if value is None or value == "":
        return D(0)
    if isinstance(value, bool):
        return D(int(value))
    try:
        result = D(str(value).strip() or "0")
        return result if result.is_finite() else D("NaN")
    except InvalidOperation:
        return D("NaN")


def positive(value):
    n = number(value)
    return n.is_finite() and n > 0


def present(value):
    return value is not None and value != "" and number(value).is_finite()


def rounded(value):
    # JS Math.round chooses the upper integer at a tie, including negative ties.
    return ((value + EPSILON) * 1000000 + D("0.5")).to_integral_value(rounding=ROUND_FLOOR) / 1000000


def convert(quantity, source, target):
    if (source not in UNITS or target not in UNITS or
            UNITS[source][0] != UNITS[target][0] or not number(quantity).is_finite()):
        raise ValueError(f"UNIT CONVERSION REQUIRED: {source} → {target}")
    return number(quantity) * UNITS[source][1] / UNITS[target][1]


def display(value):
    if value is None:
        return "not supplied"
    return f"{plain(value.quantize(D('0.001'), rounding=ROUND_HALF_UP))} g"


def plain(value):
    return format(value, "f").rstrip("0").rstrip(".") if "." in format(value, "f") else format(value, "f")


def calculate_yield(profile=None, scale=D(1), target=None, actual=None):
    profile, actual = profile or {}, actual or {}
    scale = number(scale)
    labels = [("purchased", "As purchased"), ("prepared", "Prepared / edible raw"),
              ("cooked", "Cooked"), ("usable", "Finished usable")]
    stages = []
    for key, label in labels:
        stage = profile.get(key) or {}
        grams = number(stage.get("grams")) if present(stage.get("grams")) and number(stage.get("grams")) >= 0 else None
        stages.append(dict(key=key, label=label, grams=grams, basis=stage.get("basis") or "assumed", source=stage.get("source") or ""))
    transitions = []
    for before, after in zip(stages, stages[1:]):
        a, b = before["grams"], after["grams"]
        comparable = a is not None and b is not None and a > 0
        pct = b / a * 100 if comparable else None
        transitions.append({"from": before["label"], "to": after["label"], "input": a, "output": b,
                            "yieldPercent": pct, "changeGrams": b - a if comparable else None,
                            "formula": f"{display(b)} / {display(a)} × 100 = {pct.quantize(D('0.01'), rounding=ROUND_HALF_UP):.2f}%" if comparable else "YIELD REQUIRED: both stage weights and a positive input are needed."})
    purchased, usable = stages[0]["grams"], stages[3]["grams"]
    portion = number(profile["portion_g"]) if present(profile.get("portion_g")) and positive(profile["portion_g"]) else None
    count = math.floor((usable + D("1e-8")) / portion) if usable is not None and portion is not None else None
    actual_usable = number(actual["usable_g"]) if present(actual.get("usable_g")) and number(actual["usable_g"]) >= 0 else None
    actual_count = number(actual["portions"]) if present(actual.get("portions")) else None
    if actual_count is not None and (actual_count < 0 or actual_count != actual_count.to_integral_value()):
        actual_count = None
    projected = usable * scale if usable is not None else None
    target_weight = number(target) * portion if target is not None and portion is not None else None
    warnings = []
    if any(s["grams"] is None for s in stages):
        warnings.append("YIELD REQUIRED: one or more stage weights are missing; no missing stage has been inferred.")
    if not profile.get("same_scope"):
        warnings.append("Confirm that all four weights refer to the same batch and ingredient scope. Added liquid or ingredients can create a mass gain.")
    if not profile.get("reviewed"):
        warnings.append("Yield information has not been reviewed.")
    if any(s["basis"] != "measured" or not s["source"].strip() for s in stages):
        warnings.append("Some source-batch weights are assumed or have no measurement evidence. Projections remain provisional.")
    if any(t["changeGrams"] is not None and t["changeGrams"] > 0 for t in transitions):
        warnings.append("A stage gains mass. Check additions and measurement scope; the gain is not automatically an error.")
    if portion is None:
        warnings.append("PORTION WEIGHT REQUIRED: enter a positive finished portion weight.")
    if actual_usable is None:
        warnings.append("Actual event usable weight is unmeasured.")
    if (actual_usable is not None or actual_count is not None) and not actual.get("source", "").strip():
        warnings.append("Actual event measurement source is required.")
    measured = bool(profile.get("reviewed") and profile.get("same_scope") and all(s["grams"] is not None and s["basis"] == "measured" and s["source"].strip() for s in stages))
    return dict(stages=stages, transitions=transitions, scale=scale, measured=measured,
                status="Measured source batch; event quantities are projections" if measured else "Provisional source batch",
                overallPercent=usable / purchased * 100 if purchased is not None and purchased > 0 and usable is not None else None,
                portionGrams=portion, portionCount=count, remainderGrams=usable - count * portion if count is not None else None,
                projectedStages=[{**s, "grams": s["grams"] * scale if s["grams"] is not None else None} for s in stages],
                projectedUsable=projected, projectedPortions=math.floor((projected + D("1e-8")) / portion) if projected is not None and portion is not None else None,
                targetPortions=target, targetWeight=target_weight, allocationDifference=projected - target_weight if projected is not None and target_weight is not None else None,
                actualUsable=actual_usable, actualPortions=actual_count, actualSource=actual.get("source") or "",
                varianceGrams=actual_usable - projected if actual_usable is not None and projected is not None else None,
                variancePercent=(actual_usable - projected) / projected * 100 if actual_usable is not None and projected is not None and projected > 0 else None, warnings=warnings)


def arithmetic_plan(project, versions, client_id):
    """Project only arithmetic outputs; scheduling/readiness are deliberately absent."""
    recipes = {v["id"]: v for v in versions if v.get("client_id") == client_id and v.get("status") == "approved"}
    exceptions, demand, leaves, pinned = [], {}, {}, {}

    def add(code, problem, evidence, severity="blocker"):
        exceptions.append(dict(code=code, problem=problem, evidence=evidence, severity=severity))

    price_policy = number(project.get("priceMaxAgeDays", "NaN"))
    if not price_policy.is_finite() or price_policy < 0:
        add("PRICE POLICY REQUIRED", "Enter a nonnegative maximum price age.", "Price policy")
    if not project["menu"]:
        add("MENU REQUIRED", "Add at least one approved recipe.", "Menu")

    def visit(identifier, quantity, unit, stack=(), root=None):
        root = root or identifier
        row = recipes.get(identifier)
        if row is None:
            add("RECIPE VERSION REQUIRED", "An approved recipe from this kitchen is required.", identifier)
            return
        if identifier in stack:
            add("RECIPE CYCLE", "Circular sub-recipe reference.", " → ".join((*stack, identifier)))
            return
        r = row["recipe_json"]
        if not positive(r.get("yield", {}).get("quantity")):
            add("YIELD REQUIRED", f"Missing yield for {r['title']}.", identifier)
            return
        try:
            scale = convert(quantity, unit, r["yield"]["unit"]) / number(r["yield"]["quantity"])
        except ValueError as error:
            add("UNIT CONVERSION REQUIRED", str(error), r["title"])
            return
        if scale > 500 or len(stack) > 20:
            add("PLAN LIMIT", "Split this event or simplify nested recipes.", r["title"])
            return
        if not positive(scale):
            add("QUANTITY REQUIRED", "Target must be greater than zero.", r["title"])
            return
        pinned[identifier] = row
        demand[identifier] = demand.get(identifier, D(0)) + scale
        if not r.get("source_evidence_ids"):
            add("SOURCE REQUIRED", f"Source reference missing for {r['title']}.", identifier)
        if not r.get("allergen_reviewed") or not r.get("handling_reviewed"):
            add("REVIEW REQUIRED", f"Review allergens and handling for {r['title']}.", identifier)
        if not r.get("ingredients"):
            add("INGREDIENT REVIEW REQUIRED", "Recipe has no ingredients.", r["title"])
        for ing in r.get("ingredients", []):
            if ing.get("recipe_version_id"):
                visit(ing["recipe_version_id"], number(ing.get("quantity")) * scale, ing.get("unit"), (*stack, identifier), root)
                continue
            if not ing.get("canonical_id") or ing.get("needs_review") or not positive(ing.get("quantity")):
                add("INGREDIENT REVIEW REQUIRED", f"Check {ing.get('clean_name') or 'ingredient'}.", r["title"])
                continue
            domain = UNITS.get(ing.get("unit"))
            if domain is None:
                add("UNIT CONVERSION REQUIRED", f"Unsupported unit {ing.get('unit', 'undefined')}.", r["title"])
                continue
            base = BASE[domain[0]]
            key = f"{ing['canonical_id']}|{ing.get('product_form') or ''}|{base}"
            factor = D(1) if ing.get("prep_state") == "as_purchased" else number(ing.get("purchase_yield"))
            if not positive(factor) or factor > 1:
                add("YIELD REQUIRED", f"Approved purchase yield required for {ing.get('clean_name', 'undefined')}.", r["title"])
                continue
            required = convert(number(ing["quantity"]) * scale, ing["unit"], base) / factor
            leaf = leaves.setdefault(key, dict(key=key, canonicalId=ing["canonical_id"], name=ing.get("clean_name"), form=ing.get("product_form") or "", unit=base, required=D(0), recipeDemands={}))
            leaf["required"] += required
            leaf["recipeDemands"][root] = leaf["recipeDemands"].get(root, D(0)) + required

    for item in project["menu"]:
        visit(item["versionId"], item["quantity"], item["unit"])
    purchasing = []
    for leaf in leaves.values():
        price = next((p for p in project["prices"] if p["key"] == leaf["key"]), None)
        pack_size = cost = packs = purchased = None
        try:
            age = (date.fromisoformat(project["serviceDate"]) - date.fromisoformat(price["date"])).days
        except (ValueError, TypeError, KeyError):
            age = None
        if (not price or not price.get("reviewed") or not positive(price.get("packQuantity")) or
                not number(price.get("packPrice", "NaN")).is_finite() or price.get("packPrice") == "" or number(price.get("packPrice")) < 0 or
                price.get("currency") != project["currency"] or not price.get("source") or age is None or age < 0 or (price_policy.is_finite() and age > price_policy)):
            add("PRICE REQUIRED", f"Current, reviewed {project['currency']} pack price required for {leaf['name']}.", leaf["key"])
        else:
            try:
                pack_size = convert(price["packQuantity"], price["unit"], leaf["unit"])
            except ValueError as error:
                add("UNIT CONVERSION REQUIRED", str(error), leaf["name"])
            if positive(pack_size):
                packs = math.ceil(rounded(leaf["required"] / pack_size))
                purchased = packs * pack_size
                cost = leaf["required"] / pack_size * number(price["packPrice"])
        purchasing.append({**leaf, "required": rounded(leaf["required"]), "packSize": pack_size, "packs": packs, "purchased": purchased,
                           "surplus": rounded(purchased - leaf["required"]) if purchased is not None else None, "cost": cost,
                           "purchaseCost": packs * number(price["packPrice"]) if packs is not None else None, "price": price})
    costs = []
    for item in project["menu"]:
        relevant = [p for p in purchasing if p["recipeDemands"].get(item["versionId"])]
        total = sum((p["cost"] * p["recipeDemands"][item["versionId"]] / p["required"] for p in relevant), D(0)) if relevant and all(p["cost"] is not None for p in relevant) else None
        per = total / number(item["quantity"]) if total is not None and item["unit"] == "portion" and positive(item["quantity"]) else None
        selling = number(item["sellingPrice"]) if positive(item.get("sellingPrice")) else None
        costs.append(dict(versionId=item["versionId"], total=total, perPortion=per, selling=selling, foodCostPercent=per / selling * 100 if per is not None and selling else None, grossMarginPercent=(selling - per) / selling * 100 if per is not None and selling else None))
    for rec in project["reconciliations"]:
        delta = number(rec.get("sourceKg")) - number(rec.get("portions")) * number(rec.get("portionG")) / 1000
        if not delta.is_finite() or not all(positive(rec.get(k)) for k in ("sourceKg", "portions", "portionG")):
            add("RECONCILIATION REQUIRED", "Complete both sides of the quantity comparison.", rec.get("source") or "Reconciliation")
        elif abs(delta) > D("0.000001"):
            resolution = rec.get("resolution") or "Clarify processing stage and allocation; this is not confirmed waste."
            add("QUANTITY DIFFERENCE", f"{plain(rounded(delta))} kg difference: {rec['sourceKg']} kg versus {rec['portions']} × {rec['portionG']} g. {resolution}", rec.get("source") or "Source required", "warning" if rec.get("reviewed") and rec.get("resolution", "").strip() and rec.get("source", "").strip() else "blocker")
    yields = []
    for identifier, row in pinned.items():
        r = row["recipe_json"]
        target = number(r["yield"]["quantity"]) * demand[identifier] if r["yield"]["unit"] == "portion" else None
        actual = (project.get("yieldActuals") or {}).get(identifier, {})
        report = calculate_yield(r.get("yield_profile"), demand[identifier], target, actual)
        if report["actualUsable"] is None:
            add("ACTUAL YIELD UNMEASURED", f"{row['title']}: actual event usable weight is unmeasured; the plan uses projected yield.", identifier, "warning")
        if (actual.get("usable_g") is not None and actual.get("usable_g") != "" and report["actualUsable"] is None) or (actual.get("portions") is not None and actual.get("portions") != "" and report["actualPortions"] is None):
            add("ACTUAL MEASUREMENT REVIEW REQUIRED", "Check actual weights and whole-number portion counts.", identifier)
        if (report["actualUsable"] is not None or report["actualPortions"] is not None) and not report["actualSource"].strip():
            add("ACTUAL MEASUREMENT EVIDENCE REQUIRED", "Record the source of the actual event measurement.", identifier)
        if r.get("yield_profile") and report["allocationDifference"] is not None and abs(report["allocationDifference"]) > D("0.001"):
            add("YIELD ALLOCATION DIFFERENCE", f"{row['title']}: projected usable minus portion allocation is {plain(rounded(report['allocationDifference']))} g; investigate stage and portion definitions.", identifier)
        yields.append(dict(versionId=identifier, title=row["title"], report=report))
    complete = bool(purchasing) and all(p["cost"] is not None for p in purchasing)
    return dict(recipeTargets=[dict(id=i, scale=s, quantity=rounded(s * number(pinned[i]["recipe_json"]["yield"]["quantity"]))) for i, s in demand.items()],
                purchasing=purchasing, recipeCosts=costs, yields=yields, exceptions=exceptions,
                cost=sum((p["cost"] for p in purchasing), D(0)) if complete else None,
                purchaseCost=sum((p["purchaseCost"] for p in purchasing), D(0)) if complete else None)


def run(request):
    if request.get("schemaVersion") != 1:
        raise ValueError("Unsupported arithmetic request schemaVersion; expected 1.")
    with localcontext() as context:
        context.prec = 50
        result = arithmetic_plan(request["project"], request["versions"], request["clientId"])
        conversions = []
        for row in request.get("conversions", []):
            try:
                conversions.append({"value": convert(row["quantity"], row["from"], row["to"])})
            except ValueError as error:
                conversions.append({"error": str(error)})
        return dict(engineVersion=ENGINE_VERSION, referenceEngineVersion=REFERENCE_ENGINE_VERSION, mode="shadow", arithmetic=result, conversions=conversions)


def serialize(value):
    if isinstance(value, Decimal):
        return float(value) if value.is_finite() else None
    raise TypeError(f"Cannot serialize {type(value).__name__}")


def main():
    raw = sys.stdin.buffer.read(4 * 1024 * 1024 + 1)
    try:
        if len(raw) > 4 * 1024 * 1024:
            raise ValueError("Arithmetic request exceeds 4 MiB.")
        request = json.loads(raw, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Non-finite JSON is not supported.")))
        print(json.dumps(run(request), default=serialize, allow_nan=False, ensure_ascii=False))
    except (ValueError, TypeError, KeyError, AttributeError, InvalidOperation) as error:
        print(json.dumps({"engineVersion": ENGINE_VERSION, "mode": "shadow", "error": str(error)}))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
