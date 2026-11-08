import type { Metadata } from "next";
import { AuthFrame, FormIntro } from "../_components/auth-frame";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = {
  title: "Forgotten your password?",
  robots: { index: false },
};

export default function ForgotPasswordPage() {
  return (
    <AuthFrame
      eyebrow="Forgotten your password?"
      statement={
        <>
          It happens.
          <br />
          <span className="text-brand-gradient-navy">Back in a minute.</span>
        </>
      }
      lede="We'll email you a link to choose a new password. Your bookings, cleans and messages are all still there."
    >
      <FormIntro title="Reset your password">Enter the email address you use for Ping and we&rsquo;ll send you a link.</FormIntro>
      <ForgotForm />
    </AuthFrame>
  );
}
