Design a desktop website page for a rice ordering system called Reservation Confirmation Page.

This page appears after the admin approves the customer’s reservation request. Once the reservation is approved, the system notifies the customer and redirects them to this page to complete the reservation process.

The reservation will only become successful once the customer selects the order method, chooses a payment method, and uploads the required payment proof.

Use a clean modern e-commerce website layout with two columns.

Left Column → Customer form and delivery/pickup selection
Right Column → Order summary

Page Header

Display a page title at the top:

Reservation Approved

Add a short message below the title:

“Your reservation request has been approved by the store admin. Please complete the following details to confirm your reservation.”

Left Column — Reservation Completion Form
Product Information Card

Display the reserved rice product details in a card.

Include:

Product Image

Product Name

Rice Brand

Price per sack

Reserved Quantity

Add a status label:

Reservation Approved

Order Method Selection

Below the product card, create a section called:

Choose Order Method

Add two options using radio buttons or selectable cards:

Delivery

Store Pickup

Delivery Form (if Delivery is selected)

If the customer selects Delivery, show the following input fields:

Full Name
Contact Number
Delivery Address
Delivery Notes (optional)

Pickup Form (if Store Pickup is selected)

If the customer selects Store Pickup, show the following fields:

Full Name
Phone Number
Pickup Notes (optional)

Do NOT ask for delivery address.

Instead, display the store information:

Store Address
Store Contact Number

Payment Method Section

Create a section titled:

Payment Method

Provide two options:

GCash (Full Payment)
Cash on Delivery / Pickup (30% Downpayment Required)

GCash Payment Option

If the customer selects GCash, display the store's payment details:

GCash Name
GCash Number
GCash QR Code

Add a note:

“Please send the full payment using the GCash details provided.”

Below this, create a file upload component:

Upload Payment Screenshot

The system should not allow submission if no screenshot is uploaded.

Cash on Delivery / Pickup Option

If the customer selects Cash on Delivery or Pickup, show a message:

“A 30% downpayment is required to confirm your reservation.”

Display:

Downpayment Amount (automatically calculated)

Show the same GCash payment details:

GCash Name
GCash Number
GCash QR Code

Add a file upload field:

Upload Downpayment Screenshot

Again, submission is not allowed without the uploaded screenshot.

Right Column — Order Summary

Display a sticky order summary card showing:

Product Name
Price per sack
Quantity Reserved
Subtotal

If Delivery is selected:

Delivery Fee

Final Total

Action Buttons

At the bottom of the left column include:

Primary Button
Confirm Reservation

Secondary Button
Cancel Reservation

Submission Behavior

When the customer clicks Confirm Reservation:

The system should:

Validate all required fields

Check if payment screenshot is uploaded

Save the order details

Change reservation status to:

Reservation Confirmed

Show a confirmation message:

“Your reservation has been successfully confirmed. Thank you for completing your reservation order.”

Design Style

Use a modern e-commerce website style with:

card-based layout
clear typography
rounded input fields
soft shadows
clean spacing
neutral color palette
professional UI components

The design should feel similar to a modern online store checkout page.