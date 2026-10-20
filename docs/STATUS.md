# P0.5

EFSS Markdown core: own grammar, editable source-retaining AST, typed values, explicit reference commands and provenance-aware context plans.

Memory stations: document -> source ranges -> lexical terms -> optional external embeddings -> scored recall -> cited context tray. Supports repeat-term *candidates* and evidence-bound relation *hypotheses*. Relational hypotheses are not approved facts until confirmed. Source updates invalidate derivative vectors and hypotheses.

Model embeddings are NOT generated in the core. External providers can attach vectors identified by model and dimensions. Stored vectors are not a substitute for source text and cannot be decoded back into it.

No inference of meaning from word frequency alone. No automatic model training, semantic extraction, storage backend or API/network provider is implemented.

Pending decisions: value binding syntax for multi-valued variables; scope and lifecycle of variables; inference approval/forgetting policy; semantic index backend; retrieval budget; canonical document storage and migrations.

Node built-in tests, zero runtime dependencies. No user data or private profiles stored here.
