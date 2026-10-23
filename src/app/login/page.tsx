import { AuthForm } from "@/components/auth-form";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const error = (await searchParams).error;
  return (
    <AuthForm
      confirmationError={
        error === "Confirmation link expired. Request a fresh link."
      }
    />
  );
}
