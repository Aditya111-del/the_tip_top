import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import {
  createOrder,
  createGuestOrder,
  getMyAddresses,
  Address,
  CreateOrderData,
  CreateGuestOrderData,
} from '../../services/customer-web.service';
import { OrderSuccessModal } from './OrderSuccessModal';
import { getSettings } from '../../services/settings.service';
import { apiRequest } from '../../config/api';
import { logger } from '../../utils/logger';

interface QuickCheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  cart?: Array<{
    menuItemId: string;
    name: string;
    price: number;
    quantity: number;
    selectedVariant: string;
    image?: string;
  }>;
  cartItems?: Array<{
    menuItemId: string;
    name: string;
    price: number;
    quantity: number;
    selectedVariant: string;
    image?: string;
  }>;
  onOrderPlaced?: () => void;
}

const SERVICE_AREAS = [
  { id: 'law_gate', name: 'Law Gate' },
  { id: 't_point', name: 'T Point' },
  { id: 'green_valley', name: 'Green Valley' },
  { id: 'bhutani_colony', name: 'Bhutani Colony' },
  { id: 'riya_girls_hostel', name: 'Riya Girls Hostel' },
];

export const QuickCheckoutModal: React.FC<QuickCheckoutModalProps> = ({
  isOpen,
  onClose,
  cart,
  cartItems,
  onOrderPlaced,
}) => {
  const navigate = useNavigate();
  const { customer, isAuthenticated, refreshProfile } = useCustomerAuth();
  const activeCart = cart || cartItems || [];

  const [customerName, setCustomerName] = useState<string>('');
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string>('');
  const [newArea, setNewArea] = useState<string>('Law Gate');
  const [newAddressLine, setNewAddressLine] = useState<string>('');
  const [newLandmark, setNewLandmark] = useState<string>('');
  const [isAddingNewAddress, setIsAddingNewAddress] = useState(false);
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [contactPhone, setContactPhone] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<{
    message: string;
    previousOrderNumber?: string;
  } | null>(null);
  const [confirmedSuccessOrder, setConfirmedSuccessOrder] = useState<any | null>(null);

  const subtotal = activeCart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const total = subtotal + deliveryFee;

  useEffect(() => {
    if (!isOpen) return;

    const loadData = async () => {
      try {
        const setts = await getSettings().catch(() => null);
        if (setts?.delivery?.fee || setts?.deliveryCharge) {
          setDeliveryFee(setts?.delivery?.fee || setts?.deliveryCharge || 0);
        }

        if (isAuthenticated) {
          const addrs = await getMyAddresses().catch(() => [] as Address[]);
          if (addrs && addrs.length > 0) {
            setAddresses(addrs);
            const defaultAddr = addrs.find((a) => a.isDefault) || addrs[0];
            setSelectedAddressId(defaultAddr._id);
            setIsAddingNewAddress(false);
          } else {
            setIsAddingNewAddress(true);
          }

          if (customer?.name) {
            setCustomerName(customer.name);
          }

          // Auto-fill contact phone from customer profile if available
          let userPhone = typeof customer?.phone === 'string' ? customer.phone : customer?.phone?.number;
          if (!userPhone || userPhone.startsWith('deleted_')) {
            try {
              const meRes = await apiRequest('/auth/customer/me');
              const meData = await meRes.json();
              if (meData?.data?.user?.phone) {
                const fetchedPhone =
                  typeof meData.data.user.phone === 'string'
                    ? meData.data.user.phone
                    : meData.data.user.phone.number;
                if (fetchedPhone && !fetchedPhone.startsWith('deleted_')) {
                  userPhone = fetchedPhone;
                }
              }
              if (meData?.data?.user?.name && !customerName) {
                setCustomerName(meData.data.user.name);
              }
            } catch (e) {
              // ignore network err
            }
          }

          if (userPhone && !userPhone.startsWith('deleted_')) {
            setContactPhone(userPhone.replace(/[^\d]/g, ''));
          }
        } else {
          // Guest checkout: default to adding new address and blank name
          setIsAddingNewAddress(true);
        }
      } catch (err) {
        logger.warn('Could not load checkout data', { err });
      }
    };

    loadData();
  }, [isOpen, isAuthenticated, customer]);

  if (!isOpen) return null;

  const handlePlaceOrderInstant = async (allowDuplicate = false) => {
    setError(null);
    setDuplicateWarning(null);

    const trimmedName = (customerName || customer?.name || '').trim();
    if (!isAuthenticated && !trimmedName) {
      setError('Please provide your name so we know who to deliver to.');
      return;
    }

    const cleanContact = contactPhone.replace(/[^\d]/g, '');
    if (!cleanContact || !/^[6-9]\d{9}$/.test(cleanContact)) {
      setError('Please provide a valid 10-digit mobile number for delivery contact.');
      return;
    }

    let finalAddress: { area: string; addressLine: string; landmark?: string };
    if (isAddingNewAddress) {
      if (!newAddressLine.trim()) {
        setError('Please enter your specific room / flat / hostel address.');
        return;
      }
      finalAddress = {
        area: newArea,
        addressLine: newAddressLine.trim(),
        landmark: newLandmark.trim() || undefined,
      };
    } else {
      const selected = addresses.find((a) => a._id === selectedAddressId);
      if (!selected) {
        setError('Please choose or enter a delivery address.');
        return;
      }
      finalAddress = {
        area: selected.area,
        addressLine: selected.addressLine,
        landmark: selected.landmark,
      };
    }

    setSubmitting(true);
    try {
      let order: any;

      if (!isAuthenticated) {
        // Guest order flow - no account or login needed
        const guestPayload: CreateGuestOrderData = {
          customer: {
            name: trimmedName,
            phone: cleanContact,
            email: customer?.email || undefined,
          },
          items: activeCart.map((i) => ({
            menuItem: i.menuItemId,
            name: i.name,
            quantity: i.quantity,
            price: i.price,
            portion: i.selectedVariant || 'Full',
            subtotal: i.price * i.quantity,
          })),
          orderType: 'DELIVERY',
          deliveryAddress: finalAddress,
          paymentMethod: 'COD',
          allowDuplicate,
        };

        order = await createGuestOrder(guestPayload);
      } else {
        // Authenticated customer order flow
        const orderPayload: CreateOrderData = {
          items: activeCart.map((i) => ({
            menuItem: i.menuItemId,
            name: i.name,
            quantity: i.quantity,
            price: i.price,
            portion: i.selectedVariant,
            subtotal: i.price * i.quantity,
          })),
          deliveryAddress: finalAddress as any,
          paymentMethod: 'COD',
          contactPhone: cleanContact,
          totalAmount: total,
          deliveryFee,
          allowDuplicate,
        };

        order = await createOrder(orderPayload);
      }

      // Clear Cart
      localStorage.removeItem('cart');
      window.dispatchEvent(new Event('cartUpdated'));

      if (isAuthenticated) {
        const currentPhone =
          typeof customer?.phone === 'string' ? customer.phone : customer?.phone?.number;
        if (!currentPhone || currentPhone.startsWith('deleted_')) {
          try {
            await refreshProfile();
          } catch (e) {
            // Non-blocking
          }
        }
      }

      // Show clear order confirmation modal
      setConfirmedSuccessOrder(order);
    } catch (err: any) {
      if (err?.isDuplicateWarning) {
        setDuplicateWarning({
          message: err.message,
          previousOrderNumber: err.duplicateData?.previousOrderNumber,
        });
      } else {
        setError(err?.message || 'Failed to place order. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (confirmedSuccessOrder) {
    return (
      <OrderSuccessModal
        isOpen={true}
        order={confirmedSuccessOrder}
        onClose={() => {
          setConfirmedSuccessOrder(null);
          onClose();
          if (onOrderPlaced) {
            onOrderPlaced();
          }
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white dark:bg-neutral-900 rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-neutral-200 dark:border-neutral-800 relative max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-neutral-100 dark:border-neutral-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                1-CLICK CHECKOUT
              </span>
              {!isAuthenticated && (
                <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                  Guest Checkout
                </span>
              )}
            </div>
            <h3 className="text-xl font-extrabold text-neutral-950 dark:text-white mt-0.5">
              Complete Your Order
            </h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-500 hover:text-black dark:hover:text-white flex items-center justify-center transition-colors"
          >
            ✕
          </button>
        </div>

        {!isAuthenticated && (
          <div className="mt-3 p-3 rounded-2xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200/80 dark:border-neutral-700/60 flex items-center justify-between text-xs">
            <span className="text-neutral-600 dark:text-neutral-400">
              No account required! Order in seconds.
            </span>
            <Link
              to="/customer/login"
              state={{ from: { pathname: '/customer/cart' } }}
              className="font-bold text-burgundy hover:underline shrink-0 ml-2"
            >
              Sign in
            </Link>
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-xs rounded-xl font-medium">
            {error}
          </div>
        )}

        {/* Order Items Summary */}
        <div className="py-4 border-b border-neutral-100 dark:border-neutral-800">
          <p className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2">
            Items ({activeCart.length})
          </p>
          <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
            {activeCart.map((item, idx) => (
              <div key={idx} className="flex justify-between items-center text-sm">
                <span className="text-neutral-800 dark:text-neutral-200 font-medium">
                  {item.quantity}x {item.name}{' '}
                  <span className="text-xs text-neutral-400">({item.selectedVariant})</span>
                </span>
                <span className="font-bold text-neutral-900 dark:text-white">
                  ₹{item.price * item.quantity}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Customer Name (For Guest or when not in profile) */}
        {(!isAuthenticated || !customer?.name) && (
          <div className="py-4 border-b border-neutral-100 dark:border-neutral-800">
            <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2">
              Your Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Enter your full name"
              className="w-full px-4 py-2.5 text-xs rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-900 dark:text-white outline-none focus:border-black dark:focus:border-white transition-colors"
            />
          </div>
        )}

        {/* Contact Phone Number */}
        <div className="py-4 border-b border-neutral-100 dark:border-neutral-800">
          <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2">
            Contact Phone (for Rider Delivery) <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-xs text-neutral-500 font-medium">
              +91
            </span>
            <input
              type="tel"
              maxLength={10}
              required
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value.replace(/[^\d]/g, ''))}
              placeholder="10-digit phone number"
              className="w-full pl-11 pr-4 py-2.5 text-xs rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-900 dark:text-white outline-none focus:border-black dark:focus:border-white transition-colors"
            />
          </div>
        </div>

        {/* Delivery Address Section */}
        <div className="py-4 border-b border-neutral-100 dark:border-neutral-800">
          <div className="flex items-center justify-between mb-3">
            <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">
              Delivery Destination
            </label>
            {isAuthenticated && addresses.length > 0 && (
              <button
                type="button"
                onClick={() => setIsAddingNewAddress(!isAddingNewAddress)}
                className="text-xs font-bold text-neutral-900 dark:text-neutral-200 hover:underline"
              >
                {isAddingNewAddress ? 'Choose Saved Address' : '+ New Address'}
              </button>
            )}
          </div>

          {!isAddingNewAddress && addresses.length > 0 ? (
            <div className="space-y-2">
              {addresses.map((addr) => (
                <label
                  key={addr._id}
                  className={`flex items-start gap-3 p-3 rounded-2xl border cursor-pointer transition-all ${
                    selectedAddressId === addr._id
                      ? 'border-black dark:border-white bg-neutral-50 dark:bg-neutral-800'
                      : 'border-neutral-200 dark:border-neutral-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="selectedAddress"
                    checked={selectedAddressId === addr._id}
                    onChange={() => setSelectedAddressId(addr._id)}
                    className="mt-1 accent-black"
                  />
                  <div className="text-xs">
                    <p className="font-bold text-neutral-900 dark:text-white capitalize">
                      {addr.area}
                    </p>
                    <p className="text-neutral-500 dark:text-neutral-400">
                      {addr.addressLine} {addr.landmark ? `(Near ${addr.landmark})` : ''}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-neutral-500 mb-1">
                  Area / Locality
                </label>
                <select
                  value={newArea}
                  onChange={(e) => setNewArea(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-xs font-medium text-neutral-900 dark:text-white outline-none focus:border-black"
                >
                  {SERVICE_AREAS.map((a) => (
                    <option key={a.id} value={a.name}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-neutral-500 mb-1">
                  Hostel / Building / Room Details <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Block B, Room 402, Royal Girls Hostel"
                  value={newAddressLine}
                  onChange={(e) => setNewAddressLine(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-xs text-neutral-900 dark:text-white placeholder-neutral-400 outline-none focus:border-black"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-neutral-500 mb-1">
                  Landmark (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Near Main Gate"
                  value={newLandmark}
                  onChange={(e) => setNewLandmark(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-xs text-neutral-900 dark:text-white placeholder-neutral-400 outline-none focus:border-black"
                />
              </div>
            </div>
          )}
        </div>

        {/* Payment Summary & Instant Order Action */}
        <div className="pt-4 space-y-3">
          <div className="flex justify-between text-xs text-neutral-500">
            <span>Subtotal</span>
            <span>₹{subtotal.toFixed(0)}</span>
          </div>
          <div className="flex justify-between text-xs text-neutral-500">
            <span>Delivery Fee</span>
            <span>{deliveryFee > 0 ? `₹${deliveryFee}` : 'FREE'}</span>
          </div>
          <div className="flex justify-between text-sm font-black text-neutral-950 dark:text-white pt-2 border-t border-neutral-100 dark:border-neutral-800">
            <span>Total Payable (Cash/UPI on Delivery)</span>
            <span className="text-base font-extrabold">₹{total.toFixed(0)}</span>
          </div>

          {duplicateWarning ? (
            <div className="mt-3 p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs space-y-3">
              <div className="flex items-start gap-2">
                <span className="text-base">⚠️</span>
                <div>
                  <p className="font-extrabold text-sm text-amber-950 dark:text-amber-100">
                    Duplicate Order Notice
                  </p>
                  <p className="mt-0.5 text-neutral-600 dark:text-neutral-300">
                    {duplicateWarning.message}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handlePlaceOrderInstant(true)}
                  className="flex-1 py-2.5 rounded-xl bg-burgundy text-white font-bold text-xs hover:bg-burgundy-600 transition-all shadow-xs"
                >
                  {submitting ? 'Placing...' : 'Yes, Place Order Again'}
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    setDuplicateWarning(null);
                    onClose();
                    if (isAuthenticated) {
                      navigate('/customer/orders');
                    } else {
                      navigate('/customer/menu');
                    }
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 font-bold text-xs text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 transition-all"
                >
                  {isAuthenticated ? 'View My Orders' : 'Back to Menu'}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={submitting}
              onClick={() => handlePlaceOrderInstant(false)}
              className="w-full mt-4 py-4 rounded-full bg-burgundy hover:bg-burgundy-600 text-white font-bold text-sm transition-all shadow-md active:scale-98 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? (
                <span>Placing Order...</span>
              ) : (
                <span>Confirm & Place Order (₹{total.toFixed(0)}) →</span>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default QuickCheckoutModal;
