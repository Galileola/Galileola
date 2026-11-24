"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import type { CompanyType } from "@/config/countries/ee";
import { Link } from "@/i18n/navigation";
import {
  financeInputsSchema,
  PENSION_PERCENTS,
  VAT_PERCENTS,
  type FinanceInputs,
} from "@/lib/finance/inputs";
import { calculateProjection } from "@/lib/finance/projection";
import { saveFinance } from "./actions";
import { AddButton, CheckboxField, LineCard, NumberField, Section, SelectField, TextField } from "./fields";
import { FinanceResults } from "./FinanceResults";

const newId = () => Math.random().toString(36).slice(2, 10);

function patch<T extends { id: string }>(list: T[], id: string, changes: Partial<T>): T[] {
  return list.map((line) => (line.id === id ? { ...line, ...changes } : line));
}

const isUniform = (values: number[]) => values.every((value) => value === values[0]);

type Props = {
  planId: string;
  planTitle: string;
  companyType: CompanyType;
  initialInputs: FinanceInputs;
};

export function FinanceEditor({ planId, planTitle, companyType, initialInputs }: Props) {
  const t = useTranslations("finance");
  const [inputs, setInputs] = useState(initialInputs);
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(initialInputs));
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [saving, startSaving] = useTransition();
  const [monthByMonth, setMonthByMonth] = useState(
    () => new Set(initialInputs.revenue.filter((line) => !isUniform(line.year1)).map((line) => line.id)),
  );

  const isFie = companyType === "FIE";
  const valid = useMemo(() => financeInputsSchema.safeParse(inputs), [inputs]);
  const result = useMemo(() => (valid.success ? calculateProjection(valid.data, companyType) : null), [valid, companyType]);
  const dirty = JSON.stringify(inputs) !== savedJson;

  function set<K extends keyof FinanceInputs>(key: K, value: FinanceInputs[K]) {
    setInputs((previous) => ({ ...previous, [key]: value }));
    setSaveStatus("idle");
  }

  function save() {
    startSaving(async () => {
      const response = await saveFinance(planId, inputs);
      if (response.status === "saved") {
        setSavedJson(JSON.stringify(inputs));
        setSaveStatus("saved");
      } else {
        setSaveStatus("error");
      }
    });
  }

  const delayOptions = [0, 1, 2, 3].map((value) => ({ value, label: t(`basics.delay${value}` as "basics.delay0") }));
  const vatOptions = VAT_PERCENTS.map((value) => ({ value, label: `${value}%` }));
  const pensionOptions = PENSION_PERCENTS.map((value) => ({
    value,
    label: value === 0 ? t("owner.pensionNone") : `${value}%`,
  }));

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link href={`/plans/${planId}`} className="text-sm text-blue-700 underline">
          {t("toPlan")}
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">{t("title")}</h1>
        <p className="text-slate-600">{planTitle}</p>
        <p className="text-slate-700">{t("intro")}</p>
      </div>

      <Section title={t("basics.title")}>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="text-sm">
            <label htmlFor="startMonth" className="text-slate-700">
              {t("basics.startMonth")}
            </label>
            <input
              id="startMonth"
              type="month"
              value={inputs.startMonth}
              onChange={(event) => event.target.value && set("startMonth", event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5"
            />
          </div>
          <SelectField
            label={t("basics.paymentDelay")}
            value={inputs.salesPaymentDelayMonths}
            options={delayOptions}
            onChange={(value) => set("salesPaymentDelayMonths", value)}
          />
          <div className="sm:pt-6">
            <CheckboxField
              label={t("basics.vatRegistered")}
              checked={inputs.vatRegistered}
              onChange={(value) => set("vatRegistered", value)}
            />
          </div>
        </div>
      </Section>

      <Section title={t("sales.title")} hint={t("sales.hint")}>
        {inputs.revenue.length === 0 && <p className="text-sm text-slate-500">{t("sales.empty")}</p>}
        {inputs.revenue.map((line) => {
          const showMonths = monthByMonth.has(line.id);
          const update = (changes: Partial<typeof line>) => set("revenue", patch(inputs.revenue, line.id, changes));
          return (
            <LineCard key={line.id} removeLabel={t("remove")} onRemove={() => set("revenue", inputs.revenue.filter((l) => l.id !== line.id))}>
              <TextField label={t("sales.name")} value={line.name} onChange={(name) => update({ name })} />
              <SelectField label={t("sales.vat")} value={line.vatPercent} options={vatOptions} onChange={(vatPercent) => update({ vatPercent })} />
              <NumberField
                label={t("sales.goods")}
                suffix="%"
                value={line.directCostPercent}
                onChange={(directCostPercent) => update({ directCostPercent })}
              />
              {!showMonths && (
                <NumberField
                  label={t("sales.monthly")}
                  suffix="€"
                  value={line.year1[0]}
                  onChange={(amount) => update({ year1: Array(12).fill(amount) })}
                />
              )}
              <NumberField label={t("sales.year2")} suffix="€" value={line.year2Total} onChange={(year2Total) => update({ year2Total })} />
              <NumberField label={t("sales.year3")} suffix="€" value={line.year3Total} onChange={(year3Total) => update({ year3Total })} />
              <div className="sm:col-span-2 lg:col-span-3">
                <CheckboxField
                  label={t("sales.byMonth")}
                  checked={showMonths}
                  onChange={(checked) => {
                    const next = new Set(monthByMonth);
                    if (checked) next.add(line.id);
                    else {
                      next.delete(line.id);
                      update({ year1: Array(12).fill(line.year1[0]) });
                    }
                    setMonthByMonth(next);
                  }}
                />
              </div>
              {showMonths &&
                line.year1.map((amount, month) => (
                  <NumberField
                    key={month}
                    label={t("sales.month", { number: month + 1 })}
                    suffix="€"
                    value={amount}
                    onChange={(value) => update({ year1: line.year1.map((v, i) => (i === month ? value : v)) })}
                  />
                ))}
            </LineCard>
          );
        })}
        <AddButton
          label={t("sales.newLine")}
          onClick={() =>
            set("revenue", [
              ...inputs.revenue,
              { id: newId(), name: "", vatPercent: 24, directCostPercent: 0, year1: Array(12).fill(0), year2Total: 0, year3Total: 0 },
            ])
          }
        />
      </Section>

      <Section title={t("costs.title")} hint={t("costs.hint")}>
        {inputs.costs.length === 0 && <p className="text-sm text-slate-500">{t("costs.empty")}</p>}
        {inputs.costs.map((line) => {
          const update = (changes: Partial<typeof line>) => set("costs", patch(inputs.costs, line.id, changes));
          return (
            <LineCard key={line.id} removeLabel={t("remove")} onRemove={() => set("costs", inputs.costs.filter((l) => l.id !== line.id))}>
              <TextField label={t("costs.name")} value={line.name} onChange={(name) => update({ name })} />
              <NumberField label={t("costs.monthly")} suffix="€" value={line.monthly} onChange={(monthly) => update({ monthly })} />
              <div className="sm:pt-6">
                <CheckboxField label={t("costs.hasVat")} checked={line.hasVat} onChange={(hasVat) => update({ hasVat })} />
              </div>
            </LineCard>
          );
        })}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <AddButton
            label={t("costs.newLine")}
            onClick={() => set("costs", [...inputs.costs, { id: newId(), name: "", monthly: 0, hasVat: true }])}
          />
          <div className="w-56">
            <NumberField label={t("costs.growth")} suffix="%" value={inputs.costGrowthPercent} onChange={(v) => set("costGrowthPercent", v)} />
          </div>
        </div>
      </Section>

      <Section title={t("staff.title")} hint={t("staff.hint")}>
        {inputs.staff.length === 0 && <p className="text-sm text-slate-500">{t("staff.empty")}</p>}
        {inputs.staff.map((line) => {
          const update = (changes: Partial<typeof line>) => set("staff", patch(inputs.staff, line.id, changes));
          const isBoardMember = !isFie && line.kind === "boardMember";
          return (
            <LineCard key={line.id} removeLabel={t("remove")} onRemove={() => set("staff", inputs.staff.filter((l) => l.id !== line.id))}>
              <TextField label={t("staff.role")} value={line.role} onChange={(role) => update({ role })} />
              {!isFie && (
                <SelectField
                  label={t("staff.kind")}
                  value={line.kind}
                  options={[
                    { value: "employee", label: t("staff.employee") },
                    { value: "boardMember", label: t("staff.boardMember") },
                  ]}
                  onChange={(kind) => update({ kind })}
                />
              )}
              <NumberField label={t("staff.gross")} suffix="€" value={line.grossMonthly} onChange={(grossMonthly) => update({ grossMonthly })} />
              <NumberField label={t("staff.count")} value={line.count} onChange={(count) => update({ count: Math.round(count) })} />
              <NumberField label={t("staff.startMonth")} value={line.startMonth} onChange={(startMonth) => update({ startMonth: Math.round(startMonth) })} />
              {!isBoardMember && (
                <div className="sm:pt-6">
                  <CheckboxField
                    label={t("staff.minimum")}
                    checked={line.minimumSocialTax}
                    onChange={(minimumSocialTax) => update({ minimumSocialTax })}
                  />
                </div>
              )}
            </LineCard>
          );
        })}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <AddButton
            label={t("staff.newLine")}
            onClick={() =>
              set("staff", [
                ...inputs.staff,
                { id: newId(), role: "", kind: "employee", grossMonthly: 0, count: 1, startMonth: 1, minimumSocialTax: true },
              ])
            }
          />
          <div className="w-56">
            <NumberField label={t("staff.growth")} suffix="%" value={inputs.wageGrowthPercent} onChange={(v) => set("wageGrowthPercent", v)} />
          </div>
        </div>
      </Section>

      <Section title={t("investments.title")} hint={t("investments.hint")}>
        {inputs.investments.length === 0 && <p className="text-sm text-slate-500">{t("investments.empty")}</p>}
        {inputs.investments.map((line) => {
          const update = (changes: Partial<typeof line>) => set("investments", patch(inputs.investments, line.id, changes));
          return (
            <LineCard
              key={line.id}
              removeLabel={t("remove")}
              onRemove={() => set("investments", inputs.investments.filter((l) => l.id !== line.id))}
            >
              <TextField label={t("investments.name")} value={line.name} onChange={(name) => update({ name })} />
              <NumberField label={t("investments.amount")} suffix="€" value={line.amount} onChange={(amount) => update({ amount })} />
              <NumberField label={t("investments.month")} value={line.month} onChange={(month) => update({ month: Math.round(month) })} />
              <NumberField label={t("investments.life")} value={line.lifeYears} onChange={(lifeYears) => update({ lifeYears: Math.round(lifeYears) })} />
              <div className="sm:pt-6">
                <CheckboxField label={t("investments.hasVat")} checked={line.hasVat} onChange={(hasVat) => update({ hasVat })} />
              </div>
            </LineCard>
          );
        })}
        <AddButton
          label={t("investments.newLine")}
          onClick={() =>
            set("investments", [...inputs.investments, { id: newId(), name: "", amount: 0, month: 1, hasVat: true, lifeYears: 5 }])
          }
        />
      </Section>

      <Section title={t("financing.title")}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField label={t("financing.own")} suffix="€" value={inputs.ownContribution} onChange={(v) => set("ownContribution", v)} />
          <NumberField label={t("financing.loanAmount")} suffix="€" value={inputs.loan.amount} onChange={(amount) => set("loan", { ...inputs.loan, amount })} />
          <NumberField
            label={t("financing.interest")}
            suffix="%"
            value={inputs.loan.annualInterestPercent}
            onChange={(annualInterestPercent) => set("loan", { ...inputs.loan, annualInterestPercent })}
          />
          <NumberField
            label={t("financing.term")}
            value={inputs.loan.termMonths}
            onChange={(termMonths) => set("loan", { ...inputs.loan, termMonths: Math.round(termMonths) })}
          />
          <SelectField
            label={t("financing.type")}
            value={inputs.loan.type}
            options={[
              { value: "annuity", label: t("financing.annuity") },
              { value: "equalPrincipal", label: t("financing.equalPrincipal") },
            ]}
            onChange={(type) => set("loan", { ...inputs.loan, type })}
          />
          <NumberField
            label={t("financing.grace")}
            value={inputs.loan.graceMonths}
            onChange={(graceMonths) => set("loan", { ...inputs.loan, graceMonths: Math.round(graceMonths) })}
          />
          <NumberField
            label={t("financing.disbursement")}
            value={inputs.loan.disbursementMonth}
            onChange={(disbursementMonth) => set("loan", { ...inputs.loan, disbursementMonth: Math.round(disbursementMonth) })}
          />
          <NumberField
            label={t("financing.fee")}
            suffix="%"
            value={inputs.loan.contractFeePercent}
            onChange={(contractFeePercent) => set("loan", { ...inputs.loan, contractFeePercent })}
          />
        </div>
      </Section>

      <Section title={t("owner.title")}>
        {isFie ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField label={t("owner.drawings")} suffix="€" value={inputs.ownerDrawingsMonthly} onChange={(v) => set("ownerDrawingsMonthly", v)} />
            <SelectField
              label={t("owner.pension")}
              value={inputs.fundedPensionPercent}
              options={pensionOptions}
              onChange={(v) => set("fundedPensionPercent", v)}
            />
            <div className="sm:col-span-2">
              <CheckboxField label={t("owner.exemption")} checked={inputs.useBasicExemption} onChange={(v) => set("useBasicExemption", v)} />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-slate-700">{t("owner.dividends")}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {inputs.dividends.map((amount, index) => (
                <NumberField
                  key={index}
                  label={t("owner.dividendYear", { year: index + 1 })}
                  suffix="€"
                  value={amount}
                  onChange={(value) => set("dividends", inputs.dividends.map((v, i) => (i === index ? value : v)))}
                />
              ))}
            </div>
          </div>
        )}
      </Section>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white/95 px-4 py-3">
        <p className="text-sm" role="status">
          {saveStatus === "saved" && !dirty && <span className="text-green-800">{t("saved")}</span>}
          {saveStatus === "error" && <span className="text-red-700">{t("saveError")}</span>}
          {saveStatus !== "error" && dirty && <span className="text-slate-600">{t("unsaved")}</span>}
        </p>
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty || !valid.success}
          className="rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? t("saving") : t("save")}
        </button>
      </div>

      {result ? (
        <FinanceResults result={result} companyType={companyType} />
      ) : (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-800">
          {t("invalid")}
        </p>
      )}
    </div>
  );
}
