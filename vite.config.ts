import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  server: {
    port: 3000,
    host: true,
  },
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        login: path.resolve(__dirname, 'login.html'),
        register: path.resolve(__dirname, 'register.html'),
        reviews: path.resolve(__dirname, 'reviews.html'),
        contact: path.resolve(__dirname, 'contact.html'),
        products: path.resolve(__dirname, 'products.html'),
        productDetails: path.resolve(__dirname, 'product-details.html'),
        cart: path.resolve(__dirname, 'cart.html'),
        checkout: path.resolve(__dirname, 'checkout.html'),
        reservation: path.resolve(__dirname, 'reservation.html'),
        profile: path.resolve(__dirname, 'profile.html'),
        adminDashboard: path.resolve(__dirname, 'admin/dashboard.html'),
        adminOrders: path.resolve(__dirname, 'admin/orders.html'),
        adminProducts: path.resolve(__dirname, 'admin/products.html'),
        adminCustomers: path.resolve(__dirname, 'admin/customers.html'),
        adminInquiries: path.resolve(__dirname, 'admin/inquiries.html'),
        adminStaff: path.resolve(__dirname, 'admin/staff.html'),
        adminReports: path.resolve(__dirname, 'admin/reports.html'),
        adminActivities: path.resolve(__dirname, 'admin/activities.html'),
        adminSettings: path.resolve(__dirname, 'admin/settings.html'),
        adminReservations: path.resolve(__dirname, 'admin/reservations.html'),
        adminCashTurnover: path.resolve(__dirname, 'admin/cash-turnover.html'),
        terms: path.resolve(__dirname, 'terms.html'),
        privacy: path.resolve(__dirname, 'privacy.html'),
        paymentGuide: path.resolve(__dirname, 'payment-guide.html'),
        resetPassword: path.resolve(__dirname, 'reset-password.html'),
      }
    }
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
