export default function BillingPage() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Billing</h1>
      <p className="text-sm text-muted-foreground">
        Upgrade via createCheckoutSession when Stripe keys are configured.
      </p>
    </main>
  );
}
