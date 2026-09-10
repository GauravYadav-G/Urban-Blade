import { Routes } from '@angular/router';
import { authGuard } from '@core/guards/auth.guard';
import { guestGuard } from '@core/guards/guest.guard';
import { adminGuard } from '@core/guards/admin.guard';

export const routes: Routes = [
  {
    path: 'admin/login',
    loadComponent: () =>
      import('./features/admin/pages/admin-login/admin-login').then((m) => m.AdminLogin),
  },
  {
    path: 'admin',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('@layout/admin-layout/admin-layout').then((m) => m.AdminLayout),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/admin/pages/admin-dashboard/admin-dashboard').then((m) => m.AdminDashboard),
      },
      {
        path: 'products',
        loadComponent: () =>
          import('./features/admin/pages/admin-products/admin-products').then((m) => m.AdminProducts),
      },
      {
        path: 'orders',
        loadComponent: () =>
          import('./features/admin/pages/admin-orders/admin-orders').then((m) => m.AdminOrders),
      },
      {
        path: 'bookings',
        loadComponent: () =>
          import('./features/admin/pages/admin-bookings/admin-bookings').then((m) => m.AdminBookings),
      },
      {
        path: 'customers',
        loadComponent: () =>
          import('./features/admin/pages/admin-customers/admin-customers').then((m) => m.AdminCustomers),
      },
      {
        path: 'coupons',
        loadComponent: () =>
          import('./features/admin/pages/admin-coupons/admin-coupons').then((m) => m.AdminCoupons),
      },
      {
        path: 'website',
        loadComponent: () =>
          import('./features/admin/pages/admin-website/admin-website').then((m) => m.AdminWebsite),
      },
      {
        path: 'system',
        loadComponent: () =>
          import('./features/admin/pages/admin-system/admin-system').then((m) => m.AdminSystem),
      },
    ],
  },
  {
    path: 'auth',
    loadComponent: () => import('@layout/auth-layout/auth-layout').then((m) => m.AuthLayout),
    canActivate: [guestGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'login' },
      {
        path: 'login',
        loadComponent: () =>
          import('./features/auth/pages/login-page/login-page').then((m) => m.LoginPage),
      },
      {
        path: 'register',
        loadComponent: () =>
          import('./features/auth/pages/register-page/register-page').then((m) => m.RegisterPage),
      },
    ],
  },
  {
    path: '',
    loadComponent: () => import('@layout/main-layout/main-layout').then((m) => m.MainLayout),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/home/pages/home-page/home-page').then((m) => m.HomePage),
      },
      {
        path: 'shop',
        loadComponent: () =>
          import('./features/catalog/pages/catalog-page/catalog-page').then((m) => m.CatalogPage),
      },
      {
        path: 'shop/:productId',
        loadComponent: () =>
          import('./features/catalog/pages/product-detail-page/product-detail-page').then(
            (m) => m.ProductDetailPage,
          ),
      },
      {
        path: 'cart',
        loadComponent: () =>
          import('./features/cart/pages/cart-page/cart-page').then((m) => m.CartPage),
      },
      {
        path: 'checkout',
        loadComponent: () =>
          import('./features/checkout/pages/checkout-page/checkout-page').then((m) => m.CheckoutPage),
      },
      {
        path: 'account',
        loadComponent: () =>
          import('./features/account/pages/account-page/account-page').then((m) => m.AccountPage),
      },
      {
        path: 'lists',
        loadComponent: () =>
          import('./features/account/pages/list-page/list-page').then((m) => m.ListPage),
      },
      {
        path: 'recent',
        loadComponent: () =>
          import('./features/account/pages/recent-page/recent-page').then((m) => m.RecentPage),
      },
      {
        path: 'sell',
        loadComponent: () =>
          import('./features/info/pages/sell-page/sell-page').then((m) => m.SellPage),
      },
      {
        path: 'orders',
        canActivate: [authGuard],
        loadComponent: () =>
          import('./features/orders/pages/orders-page/orders-page').then((m) => m.OrdersPage),
      },
      {
        path: 'book',
        loadComponent: () =>
          import('./features/bookings/pages/book-page/book-page').then((m) => m.BookPage),
      },
      {
        path: 'help',
        loadComponent: () =>
          import('./features/help/pages/help-page/help-page').then((m) => m.HelpPage),
      },
      {
        path: 'support',
        loadComponent: () =>
          import('./features/help/pages/support-page/support-page').then((m) => m.SupportPage),
      },
      {
        path: 'terms',
        loadComponent: () =>
          import('./features/info/pages/terms-page/terms-page').then((m) => m.TermsPage),
      },
      {
        path: 'privacy',
        loadComponent: () =>
          import('./features/info/pages/privacy-page/privacy-page').then((m) => m.PrivacyPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
