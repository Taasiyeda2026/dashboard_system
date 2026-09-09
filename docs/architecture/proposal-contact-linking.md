# Proposal contact linking contract

New school proposals that contain contact details must persist or resolve the contact in `contacts_schools` before the proposal insert, then store that row ID in `proposals_agreements.contact_school_id`.

The school catalogue ID must never be copied into `contact_school_id`; `schools.id` and `contacts_schools.id` are independent identities.

Existing `contact_school_id` values must be preserved without creating another contact. Clone requests and non-school clients are outside this automatic linkage path.

Sent proposals remain immutable. A missing historical contact link must not be backfilled by changing a sent proposal or by enriching its saved contact snapshot from live contact data.
