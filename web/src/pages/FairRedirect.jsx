import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

/**
 * School-fair smart link (the flyer QR points here). Always lands on the WEB
 * signup - on every device, iPhone included - tagged with the promo so the
 * Stripe code is saved to the account and auto-applied at checkout.
 *
 * We deliberately do NOT bounce iPhones to the App Store: the discount is a
 * Stripe / web-checkout coupon (not an Apple Offer Code), and the web
 * onboarding ends with its own "get the app" step anyway, so sending parents
 * to the App Store first would just lose the promo.
 *
 * The campaign code comes ENTIRELY from `?promo=` - each flyer QR must include
 * it (e.g. /fair?promo=HILLELFEST). No default, so a bare /fair never applies a
 * stale code from a different school.
 */
export default function FairRedirect() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const promo = params.get('promo');

  useEffect(() => {
    navigate(promo ? `/signup?promo=${encodeURIComponent(promo)}` : '/signup', { replace: true });
  }, [navigate, promo]);

  return null;
}
