import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ConfirmDialog,
  ErrorState,
  LoadingState,
} from "../properties/PropertiesPages";
import { apiRequest } from "../../lib/api";
import {
  fetchInvoice,
  fetchInvoiceReservation,
  fetchInvoiceReservations,
  fetchInvoices,
  formatInvoiceMoney,
  type Invoice,
  type InvoiceDraftInput,
  type InvoiceStatus,
  type InvoiceSummary,
  type PaymentMethod,
  type ReservationChoice,
} from "./api";
import "./Billing.css";

type PageProps = {
  navigate: (path: string) => void;
  flash: (message: string) => void;
};

type InvoiceItemForm = {
  description: string;
  quantity: string;
  unitPrice: string;
};

type InvoiceFormValues = {
  reservationId: string;
  issueDate: string;
  dueDate: string;
  taxRate: string;
  notes: string;
  items: InvoiceItemForm[];
};

type InvoiceAction = "issue" | "void" | "payment-form" | "payment-confirm" | null;

const emptyItem: InvoiceItemForm = {
  description: "Accommodation charges",
  quantity: "1",
  unitPrice: "",
};

const statuses: Array<InvoiceStatus | "all"> = [
  "all",
  "draft",
  "issued",
  "partially_paid",
  "paid",
  "void",
];

export function BillingPage({ navigate }: PageProps) {
  const [status, setStatus] = useState<InvoiceStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      fetchInvoices({ status, q: search.trim(), offset })
        .then((result) => {
          if (!active) return;
          setInvoices(result.invoices);
          setTotal(result.total);
        })
        .catch((reason: unknown) => {
          if (active) setError(errorMessage(reason));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, search ? 180 : 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [status, search, offset, refreshKey]);

  const updateFilters = (update: () => void) => {
    setOffset(0);
    update();
  };

  return (
    <section className="page-section billing-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow"><span /> BILLING &amp; INVOICING</p>
          <h1 className="page-title">Billing</h1>
          <p className="page-intro">Create reservation-linked invoices and track manually recorded payments.</p>
        </div>
        <button className="button button-primary" onClick={() => navigate("/billing/new")}>
          <span aria-hidden="true">＋</span> Create invoice
        </button>
      </div>

      <div className="billing-filters">
        <label className="billing-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={search}
            onChange={(event) => updateFilters(() => setSearch(event.target.value))}
            placeholder="Search invoice, reservation, guest, or property"
            aria-label="Search invoices"
            maxLength={120}
          />
        </label>
        <div className="tab-group billing-status-tabs" aria-label="Invoice status filter">
          {statuses.map((value) => (
            <button
              className={status === value ? "tab active" : "tab"}
              key={value}
              aria-pressed={status === value}
              onClick={() => updateFilters(() => setStatus(value))}
            >
              {statusLabel(value)}
            </button>
          ))}
        </div>
      </div>

      {!loading && !error && <p className="result-count">{total} {total === 1 ? "invoice" : "invoices"}</p>}
      {loading && <LoadingState label="Loading invoices…" />}
      {error && (
        <div>
          <ErrorState message={error} />
          <button className="button button-secondary" onClick={() => {
            setOffset(0);
            setRefreshKey((key) => key + 1);
          }}>Try again</button>
        </div>
      )}
      {!loading && !error && invoices.length === 0 && (
        <div className="state-panel empty-state">
          <span className="empty-icon" aria-hidden="true">＄</span>
          <h2>{search || status !== "all" ? "No invoices match these filters" : "No invoices yet"}</h2>
          <p>Choose a reservation and create a draft invoice to begin tracking charges and balances.</p>
          <button className="button button-primary" onClick={() => navigate("/billing/new")}>Create a draft invoice</button>
        </div>
      )}
      {!loading && !error && invoices.length > 0 && (
        <>
          <div className="billing-list">
            <div className="billing-list-head">
              <span>Invoice</span><span>Reservation</span><span>Total</span><span>Paid</span><span>Balance</span><span>Status</span>
            </div>
            {invoices.map((invoice) => (
              <button
                className="billing-row"
                key={invoice.id}
                onClick={() => navigate(`/billing/${invoice.id}`)}
              >
                <span className="billing-row-main">
                  <strong>{invoice.invoiceNumber}</strong>
                  <small>Issued {formatDate(invoice.issueDate)}</small>
                </span>
                <span className="billing-row-main">
                  <strong>{invoice.reservationReference} · {invoice.guestName}</strong>
                  <small>{invoice.propertyName}{invoice.unitName ? ` · ${invoice.unitName}` : ""}</small>
                </span>
                <span className="billing-amount">{formatInvoiceMoney(invoice.totalCents, invoice.currency)}</span>
                <span className="billing-amount">{formatInvoiceMoney(invoice.paidCents, invoice.currency)}</span>
                <span className="billing-amount">{formatInvoiceMoney(invoice.balanceCents, invoice.currency)}</span>
                <span className={`status-pill invoice-status ${invoice.status}`}>{statusLabel(invoice.status)}</span>
              </button>
            ))}
          </div>
          <div className="billing-pagination">
            <span>Showing {offset + 1}–{Math.min(offset + invoices.length, total)} of {total}</span>
            <div>
              <button className="button button-secondary" disabled={offset === 0} onClick={() => setOffset((value) => Math.max(0, value - 50))}>Previous</button>
              <button className="button button-secondary" disabled={offset + invoices.length >= total} onClick={() => setOffset((value) => value + 50)}>Next</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export function InvoiceFormPage({
  invoiceId,
  navigate,
  flash,
}: PageProps & { invoiceId?: number }) {
  const [values, setValues] = useState<InvoiceFormValues>({
    reservationId: "",
    issueDate: todayLocal(),
    dueDate: "",
    taxRate: "0",
    notes: "",
    items: [{ ...emptyItem }],
  });
  const [reservationSearch, setReservationSearch] = useState("");
  const [reservations, setReservations] = useState<ReservationChoice[]>([]);
  const [selectedReservation, setSelectedReservation] = useState<ReservationChoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetchInvoiceReservations(reservationSearch)
      .then(({ reservations: choices }) => {
        if (active) setReservations(choices);
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason));
      });
    return () => {
      active = false;
    };
  }, [reservationSearch]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        if (invoiceId !== undefined) {
          const { invoice } = await fetchInvoice(invoiceId);
          if (!active) return;
          if (invoice.status !== "draft") {
            setError("Only draft invoices can be edited.");
            return;
          }
          const { reservation } = await fetchInvoiceReservation(invoice.reservationId);
          if (!active) return;
          setSelectedReservation(reservation);
          setValues({
            reservationId: String(invoice.reservationId),
            issueDate: invoice.issueDate,
            dueDate: invoice.dueDate ?? "",
            taxRate: formatTaxRate(invoice.taxRateBps),
            notes: invoice.notes ?? "",
            items: invoice.items.map((item) => ({
              description: item.description,
              quantity: String(item.quantity),
              unitPrice: centsToAmount(item.unitPriceCents),
            })),
          });
          return;
        }
        const requestedId = new URLSearchParams(window.location.search).get("reservationId");
        if (requestedId && /^[1-9]\d*$/.test(requestedId)) {
          const { reservation } = await fetchInvoiceReservation(Number(requestedId));
          if (!active) return;
          setSelectedReservation(reservation);
          setValues((current) => ({
            ...current,
            reservationId: String(reservation.id),
            items: [{
              ...emptyItem,
              unitPrice: centsToAmount(reservation.totalAmountCents),
            }],
          }));
        }
      } catch (reason) {
        if (active) setError(errorMessage(reason));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [invoiceId]);

  const preview = useMemo(() => calculatePreview(values.items, values.taxRate), [values.items, values.taxRate]);
  const update = (field: keyof Omit<InvoiceFormValues, "items">, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
  };
  const updateItem = (index: number, field: keyof InvoiceItemForm, value: string) => {
    setValues((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item,
      ),
    }));
  };

  const chooseReservation = (id: string) => {
    const choice = reservations.find((reservation) => String(reservation.id) === id) ??
      (selectedReservation?.id === Number(id) ? selectedReservation : null);
    setSelectedReservation(choice);
    setValues((current) => ({
      ...current,
      reservationId: id,
      ...(!invoiceId && choice && current.items.length === 1 &&
        current.items[0].description === emptyItem.description
        ? {
            items: [{
              ...emptyItem,
              unitPrice: centsToAmount(choice.totalAmountCents),
            }],
          }
        : {}),
    }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!preview || !selectedReservation || !values.reservationId) {
      setError("Choose a reservation and enter valid line items before saving.");
      return;
    }
    const input: InvoiceDraftInput = {
      reservationId: Number(values.reservationId),
      issueDate: values.issueDate,
      dueDate: values.dueDate || null,
      taxRate: values.taxRate.trim() || "0",
      notes: values.notes.trim() || null,
      items: values.items.map((item) => ({
        description: item.description.trim(),
        quantity: Number(item.quantity),
        unitPrice: item.unitPrice,
      })),
    };
    setSaving(true);
    setError("");
    try {
      const result = invoiceId === undefined
        ? await apiRequest<{ invoice: Invoice }>("/invoices", "POST", input)
        : await apiRequest<{ invoice: Invoice }>(`/invoices/${invoiceId}`, "PUT", input);
      flash(invoiceId === undefined ? "Draft invoice created." : "Draft invoice updated.");
      navigate(`/billing/${result.invoice.id}`);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState label={invoiceId ? "Loading draft invoice…" : "Preparing invoice form…"} />;
  if (error && invoiceId !== undefined && !selectedReservation) {
    return <ErrorState message={error} back={() => navigate("/billing")} />;
  }

  return (
    <section className="page-section billing-page">
      <button className="back-link" onClick={() => navigate(invoiceId ? `/billing/${invoiceId}` : "/billing")}>
        <span aria-hidden="true">←</span> {invoiceId ? "Back to invoice" : "All invoices"}
      </button>
      <div className="form-heading">
        <div>
          <p className="eyebrow"><span /> DRAFT INVOICE</p>
          <h1 className="page-title">{invoiceId ? "Edit draft" : "Create an invoice"}</h1>
          <p className="page-intro">Review the reservation and manually entered charges before saving this draft.</p>
        </div>
      </div>
      {error && <div className="billing-inline-error" role="alert">{error}</div>}
      <form className="billing-form" onSubmit={(event) => void submit(event)}>
        <div className="form-grid">
          <label className="form-field span-2">
            <span className="field-label">Reservation <span className="required-mark">*</span></span>
            <input
              type="search"
              value={reservationSearch}
              onChange={(event) => setReservationSearch(event.target.value)}
              placeholder="Search reservation, guest, property, or unit"
              aria-label="Search reservations"
            />
            <select
              value={values.reservationId}
              onChange={(event) => chooseReservation(event.target.value)}
              required
            >
              <option value="">Choose a reservation</option>
              {selectedReservation && !reservations.some((item) => item.id === selectedReservation.id) && (
                <option value={selectedReservation.id}>
                  {selectedReservation.reservationReference} · {selectedReservation.guestName}
                </option>
              )}
              {reservations.map((reservation) => (
                <option key={reservation.id} value={reservation.id}>
                  {reservation.reservationReference} · {reservation.guestName} · {reservation.propertyName} · {formatDate(reservation.checkIn)}
                </option>
              ))}
            </select>
            <span className="field-hint">
              Select one existing reservation. No invoice is created until you save this draft.
            </span>
          </label>
          {selectedReservation && (
            <div className="billing-reservation-review span-2">
              <strong>{selectedReservation.reservationReference} · {selectedReservation.guestName}</strong>
              <span>{selectedReservation.propertyName}{selectedReservation.unitName ? ` · ${selectedReservation.unitName}` : ""}</span>
              <span>{formatDate(selectedReservation.checkIn)} – {formatDate(selectedReservation.checkOut)} · {formatInvoiceMoney(selectedReservation.totalAmountCents, selectedReservation.currency)} reservation total</span>
            </div>
          )}
          <label className="form-field">
            <span className="field-label">Issue date <span className="required-mark">*</span></span>
            <input type="date" value={values.issueDate} onChange={(event) => update("issueDate", event.target.value)} required />
          </label>
          <label className="form-field">
            <span className="field-label">Due date</span>
            <input type="date" min={values.issueDate} value={values.dueDate} onChange={(event) => update("dueDate", event.target.value)} />
          </label>
          <label className="form-field">
            <span className="field-label">Currency</span>
            <input value={selectedReservation?.currency ?? "Select a reservation"} readOnly />
            <span className="field-hint">Inherited from the reservation; no currency conversion is performed.</span>
          </label>
          <label className="form-field">
            <span className="field-label">Tax rate (%)</span>
            <input type="number" min="0" max="100" step="0.01" value={values.taxRate} onChange={(event) => update("taxRate", event.target.value)} />
            <span className="field-hint">Optional and manually supplied; not verified against tax rules.</span>
          </label>
        </div>

        <div className="billing-lines-heading">
          <div>
            <h2>Line items</h2>
            <p>Suggested accommodation amount is copied from the selected reservation for your review.</p>
          </div>
          <button className="button button-secondary" type="button" onClick={() => setValues((current) => ({
            ...current,
            items: [...current.items, { description: "", quantity: "1", unitPrice: "" }],
          }))}>Add line item</button>
        </div>
        <div className="billing-line-list">
          {values.items.map((item, index) => (
            <div className="billing-line-edit" key={index}>
              <label className="form-field billing-line-description">
                <span className="field-label">Description</span>
                <input maxLength={250} value={item.description} onChange={(event) => updateItem(index, "description", event.target.value)} required />
              </label>
              <label className="form-field billing-line-quantity">
                <span className="field-label">Quantity</span>
                <input type="number" min="1" max="100000" step="1" value={item.quantity} onChange={(event) => updateItem(index, "quantity", event.target.value)} required />
              </label>
              <label className="form-field billing-line-price">
                <span className="field-label">Unit price ({selectedReservation?.currency ?? "—"})</span>
                <input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => updateItem(index, "unitPrice", event.target.value)} required />
              </label>
              <div className="billing-line-total">
                <span className="field-label">Line total</span>
                <strong>{preview && selectedReservation
                  ? formatInvoiceMoney(preview.lineTotals[index] ?? 0, selectedReservation.currency)
                  : "—"}</strong>
              </div>
              <button
                className="billing-remove-line"
                type="button"
                onClick={() => setValues((current) => ({
                  ...current,
                  items: current.items.filter((_, itemIndex) => itemIndex !== index),
                }))}
                aria-label={`Remove line item ${index + 1}`}
              >×</button>
            </div>
          ))}
        </div>

        <label className="form-field billing-notes">
          <span className="field-label">Invoice notes</span>
          <textarea rows={3} maxLength={2000} value={values.notes} onChange={(event) => update("notes", event.target.value)} />
        </label>
        <div className="billing-totals" aria-live="polite">
          <div><span>Subtotal</span><strong>{preview && selectedReservation ? formatInvoiceMoney(preview.subtotalCents, selectedReservation.currency) : "—"}</strong></div>
          <div><span>Tax</span><strong>{preview && selectedReservation ? formatInvoiceMoney(preview.taxCents, selectedReservation.currency) : "—"}</strong></div>
          <div className="billing-grand-total"><span>Draft total</span><strong>{preview && selectedReservation ? formatInvoiceMoney(preview.totalCents, selectedReservation.currency) : "—"}</strong></div>
          <p>Totals are calculated by the API from integer minor units; tax rounding is to the nearest cent, half up.</p>
        </div>
        <div className="form-actions">
          <button className="button button-secondary" type="button" onClick={() => navigate(invoiceId ? `/billing/${invoiceId}` : "/billing")}>Cancel</button>
          <button className="button button-primary" type="submit" disabled={saving || !preview || !selectedReservation}>
            {saving ? "Saving…" : "Save draft"}
          </button>
        </div>
      </form>
    </section>
  );
}

export function InvoiceDetailsPage({
  invoiceId,
  navigate,
  flash,
}: PageProps & { invoiceId: number }) {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [action, setAction] = useState<InvoiceAction>(null);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(localDateTimeInput());
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    let active = true;
    fetchInvoice(invoiceId)
      .then(({ invoice: record }) => {
        if (active) setInvoice(record);
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [invoiceId, refreshKey]);

  const confirmAction = async () => {
    if (!action || !invoice) return;
    setBusy(true);
    setError("");
    try {
      if (action === "issue" || action === "void") {
        const result = await apiRequest<{ invoice: Invoice }>(
          `/invoices/${invoice.id}/${action}`,
          "POST",
        );
        setInvoice(result.invoice);
        flash(action === "issue" ? "Invoice issued." : "Invoice voided.");
      } else {
        const parsedDate = new Date(paymentDate);
        if (!Number.isFinite(parsedDate.valueOf())) throw new Error("Enter a valid payment date and time.");
        const result = await apiRequest<{ invoice: Invoice; duplicate: boolean }>(
          `/invoices/${invoice.id}/payments`,
          "POST",
          {
            paymentDate: parsedDate.toISOString(),
            amount,
            method,
            reference: reference.trim() || null,
            note: paymentNote.trim() || null,
            idempotencyKey,
          },
        );
        setInvoice(result.invoice);
        flash(result.duplicate ? "This payment was already recorded." : "Payment recorded.");
        setAmount("");
        setReference("");
        setPaymentNote("");
        setPaymentDate(localDateTimeInput());
        setIdempotencyKey(crypto.randomUUID());
      }
      setAction(null);
    } catch (reason) {
      setError(errorMessage(reason));
      if (action === "payment-confirm") setAction("payment-form");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingState label="Loading invoice…" />;
  if (error && !invoice) return <ErrorState message={error} back={() => navigate("/billing")} />;
  if (!invoice) return null;
  const canVoid = invoice.status === "issued" && invoice.paidCents === 0;
  const canPay = ["issued", "partially_paid"].includes(invoice.status) && invoice.balanceCents > 0;

  return (
    <section className="page-section billing-page">
      <button className="back-link" onClick={() => navigate("/billing")}><span aria-hidden="true">←</span> All invoices</button>
      {error && (
        <div className="billing-inline-error" role="alert">
          {error}
          <button onClick={() => {
            setError("");
            setLoading(true);
            setRefreshKey((key) => key + 1);
          }}>Retry</button>
        </div>
      )}
      <div className="detail-heading billing-detail-heading">
        <div className="detail-title-group">
          <span className="detail-icon billing-detail-icon" aria-hidden="true">＄</span>
          <div>
            <p className="eyebrow"><span /> INVOICE · {invoice.invoiceNumber}</p>
            <h1 className="page-title">{invoice.reservationReference}</h1>
            <p className="page-intro">{invoice.guestName} · {invoice.propertyName}{invoice.unitName ? ` · ${invoice.unitName}` : ""}</p>
          </div>
        </div>
        <div className="heading-actions">
          <span className={`status-pill invoice-status ${invoice.status}`}>{statusLabel(invoice.status)}</span>
          {invoice.status === "draft" && (
            <>
              <button className="button button-secondary" onClick={() => navigate(`/billing/${invoice.id}/edit`)}>Edit draft</button>
              <button className="button button-primary" onClick={() => setAction("issue")}>Issue invoice</button>
            </>
          )}
          {canVoid && <button className="button button-danger-outline" onClick={() => setAction("void")}>Void invoice</button>}
          <button className="button button-secondary" onClick={() => navigate(`/reservations/${invoice.reservationId}`)}>Open reservation</button>
        </div>
      </div>

      <div className="billing-detail-grid">
        <article className="info-card">
          <h2>Invoice details</h2>
          <div className="info-rows">
            <DetailRow label="Issue date" value={formatDate(invoice.issueDate)} />
            <DetailRow label="Due date" value={invoice.dueDate ? formatDate(invoice.dueDate) : "Not set"} />
            <DetailRow label="Currency" value={invoice.currency} />
            <DetailRow label="Reservation" value={invoice.reservationReference} />
            <DetailRow label="Stay" value={`${formatDate(invoice.checkIn)} – ${formatDate(invoice.checkOut)}`} />
            <DetailRow label="Reservation status" value={invoice.status === "void" ? "Invoice void" : "Reservation remains unchanged"} />
          </div>
        </article>
        <article className="info-card">
          <h2>Balance summary</h2>
          <div className="info-rows">
            <DetailRow label="Subtotal" value={formatInvoiceMoney(invoice.subtotalCents, invoice.currency)} />
            <DetailRow label={`Tax (${formatTaxRate(invoice.taxRateBps)}%)`} value={formatInvoiceMoney(invoice.taxAmountCents, invoice.currency)} />
            <DetailRow label="Grand total" value={formatInvoiceMoney(invoice.totalCents, invoice.currency)} />
            <DetailRow label="Payments recorded" value={formatInvoiceMoney(invoice.paidCents, invoice.currency)} />
            <DetailRow label="Outstanding balance" value={formatInvoiceMoney(invoice.balanceCents, invoice.currency)} />
          </div>
        </article>
      </div>

      <section className="billing-detail-section">
        <h2>Line items</h2>
        <div className="billing-list billing-detail-lines">
          <div className="billing-list-head"><span>Description</span><span>Quantity</span><span>Unit price</span><span>Line total</span></div>
          {invoice.items.map((item) => (
            <div className="billing-row billing-static-row" key={item.id}>
              <span className="billing-row-main"><strong>{item.description}</strong></span>
              <span>{item.quantity}</span>
              <span>{formatInvoiceMoney(item.unitPriceCents, invoice.currency)}</span>
              <span className="billing-amount">{formatInvoiceMoney(item.lineTotalCents, invoice.currency)}</span>
            </div>
          ))}
        </div>
        {invoice.notes && <p className="billing-notes-display"><strong>Invoice notes:</strong> {invoice.notes}</p>}
        {invoice.status === "draft" && (
          <p className="billing-policy-note">Draft amounts may be edited. Issuing locks the line items and financial snapshot.</p>
        )}
        {invoice.status !== "draft" && (
          <p className="billing-policy-note">This invoice snapshot does not change when its reservation is edited. Only an unpaid issued invoice may be voided; recorded payments cannot be reversed or refunded in this phase. Tax and charges are manually entered and are not verified against external tax rules.</p>
        )}
      </section>

      <section className="billing-detail-section">
        <div className="billing-lines-heading">
          <div><h2>Payment history</h2><p>Bookkeeping only; no processor integration, refunds, or reversals.</p></div>
          {canPay && <button className="button button-primary" onClick={() => setAction("payment-form")}>Record payment</button>}
        </div>
        {invoice.payments.length === 0 ? (
          <div className="state-panel billing-empty-payments">No payments recorded.</div>
        ) : (
          <div className="billing-payment-list">
            {invoice.payments.map((payment) => (
              <article className="billing-payment-row" key={payment.id}>
                <div><strong>{formatInvoiceMoney(payment.amountCents, invoice.currency)}</strong><small>{formatTimestamp(payment.paymentDate)} · {methodLabel(payment.method)}</small></div>
                <div>{payment.reference && <span>Reference: {payment.reference}</span>}{payment.note && <small>{payment.note}</small>}</div>
              </article>
            ))}
          </div>
        )}
      </section>

      {canPay && action === "payment-form" && (
        <form className="billing-payment-form" onSubmit={(event) => {
          event.preventDefault();
          setAction("payment-confirm");
        }}>
          <h2>Record a payment</h2>
          <p>Enter bookkeeping details only. Do not enter card, bank, or login credentials.</p>
          <div className="form-grid">
            <label className="form-field">
              <span className="field-label">Amount ({invoice.currency})</span>
              <input type="number" min="0.01" max={(invoice.balanceCents / 100).toFixed(2)} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required />
            </label>
            <label className="form-field">
              <span className="field-label">Payment date and time</span>
              <input type="datetime-local" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} required />
            </label>
            <label className="form-field">
              <span className="field-label">Method</span>
              <select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="card_terminal">Card terminal (reference only)</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="form-field">
              <span className="field-label">Optional reference</span>
              <input maxLength={120} value={reference} onChange={(event) => setReference(event.target.value)} />
            </label>
            <label className="form-field span-2">
              <span className="field-label">Short internal note</span>
              <textarea rows={2} maxLength={500} value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} />
            </label>
          </div>
          <div className="billing-payment-actions">
            <button className="button button-secondary" type="button" onClick={() => setAction(null)}>Cancel</button>
            <button className="button button-primary" type="submit" disabled={!amount}>Review and record payment</button>
          </div>
        </form>
      )}

      <ConfirmDialog
        open={action === "issue" || action === "void" || action === "payment-confirm"}
        title={action === "issue" ? "Issue this invoice?" : action === "void" ? "Void this unpaid invoice?" : "Record this payment?"}
        detail={action === "issue"
          ? "This locks the invoice line items and financial snapshot. Later reservation changes will not alter it."
          : action === "void"
            ? "The issued invoice will remain in history and cannot accept payments. Invoices with recorded payments cannot be voided."
            : `Record ${amount || "the entered amount"} ${invoice.currency} against ${invoice.invoiceNumber}. The API will re-check the outstanding balance.`}
        confirmLabel={action === "issue" ? "Issue invoice" : action === "void" ? "Void invoice" : "Record payment"}
        busy={busy}
        onCancel={() => setAction(action === "payment-confirm" ? "payment-form" : null)}
        onConfirm={() => void confirmAction()}
      />
    </section>
  );
}

function calculatePreview(items: InvoiceItemForm[], taxRate: string) {
  const taxRateBps = parseTaxRate(taxRate);
  if (taxRateBps === null) return null;
  let subtotal = 0n;
  const lineTotals: number[] = [];
  for (const item of items) {
    const quantity = Number(item.quantity);
    const unitPrice = parseAmountCents(item.unitPrice);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100_000 || unitPrice === null) return null;
    const lineTotal = BigInt(quantity) * BigInt(unitPrice);
    subtotal += lineTotal;
    if (subtotal > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    lineTotals.push(Number(lineTotal));
  }
  const tax = (subtotal * BigInt(taxRateBps) + 5_000n) / 10_000n;
  const total = subtotal + tax;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return {
    lineTotals,
    subtotalCents: Number(subtotal),
    taxCents: Number(tax),
    totalCents: Number(total),
  };
}

function parseAmountCents(value: string): number | null {
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}

function parseTaxRate(value: string): number | null {
  if (value.trim() === "") return 0;
  if (!/^(?:0|[1-9]\d?)(?:\.\d{1,2})?$|^100(?:\.0{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

function centsToAmount(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function formatTaxRate(basisPoints: number): string {
  return (basisPoints / 100).toFixed(2).replace(/\.?0+$/, "");
}

function statusLabel(status: InvoiceStatus | "all"): string {
  if (status === "all") return "All";
  return status.replaceAll("_", " ");
}

function methodLabel(method: PaymentMethod): string {
  return method.replaceAll("_", " ");
}

function formatDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf())
    ? value
    : parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? value
    : parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function todayLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function localDateTimeInput(): string {
  const now = new Date();
  return `${todayLocal()}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className="detail-row"><span>{label}</span><strong>{value}</strong></div>;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "An unexpected error occurred.";
}
