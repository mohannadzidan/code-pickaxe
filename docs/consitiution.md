### 1. Separate Rendering from Domain Logic
The user interface is only a projection of application state. All business rules, state transitions, and side effects reside in plain, framework‑agnostic modules. Components (or UI bindings) map state to visual output and forward user events to action dispatches, containing no business logic of their own.

### 2. Enforce Unidirectional Dependency Layers
Organise code into distinct layers (e.g., Types → Services → State → Orchestration → Presentation) with a clear, downward dependency direction. Lower layers know nothing about higher layers. This eliminates cycles, prevents accidental coupling, and makes each layer replaceable and testable.

### 3. Model State by Domain, Not by Screen
Split state containers according to business domains – cohesive concepts with their own vocabulary, state shape, and invariants. Avoid “god” containers that manage unrelated concerns. Each domain’s state is self‑contained, aligned with the problem space, and can be understood in isolation.

### 4. Keep State Flat and Normalised
Store collections as key‑value maps (e.g., by ID) with relationships expressed as IDs rather than nested objects. Derive denormalised views on read. This prevents duplication, simplifies updates, avoids consistency drift, and eliminates synchronisation problems.

### 5. Compute Derived Values, Do Not Store Them
Any value that can be calculated from existing state must be computed at read time using memoised functions (selectors, getters, views). Storing derived data is forbidden except for genuinely expensive computations that are explicitly memoised. This avoids unnecessary synchronisation overhead and prevents bugs.

### 6. Name State‑Changing Operations After Business Events
Public methods that modify state must reflect domain intentions (e.g., `approveInvoice`, `assignUserToTeam`). Generic setters (`setData`, `update`) are forbidden because they leak internal structure and encourage business logic to spill into consumers. Business logic stays inside the state manager.

### 7. Keep State Containers Free of Framework Dependencies
State managers (stores, containers) must never import UI framework primitives (hooks, DOM references, component types). They operate exclusively on plain data structures, ensuring portability across different presentation layers, simplifying testing, and making them framework‑independent.

### 8. Never Let One Domain Directly Import Another Domain’s State Container
Domains are peers. One domain’s store never imports another domain’s store. If an action in domain A should affect domain B, the coordination belongs in an explicit orchestrator – never in a direct call or a reactive subscription. This keeps domains decoupled and independently evolvable.

### 9. Use Orchestrators for Cross‑Domain Workflows
Imperative, multi‑domain sequences are handled by dedicated orchestrator functions. An orchestrator imports the necessary stores and services, reads state, performs logic, and dispatches actions to multiple stores. It contains only coordination logic – not business rules – making cross‑domain behaviour explicit and centralised.

### 10. Coordinate via Shared Identity, Not Direct References
When multiple domains need to react to a common concept (e.g., “current selection”), store that identity in its own tiny container. Different domains subscribe to that identity independently for rendering. The actions triggered by a change are performed by an orchestrator at the moment of the change – not reactively, and not via direct cross‑domain references.

### 11. Expose Read Access Only Through Named Selectors
All read access to state (by presentation, orchestrators, or other layers) must go through named, exported selector functions. Direct access to raw state is disallowed. Selectors request the minimum data needed, returning primitives or stable references to avoid unnecessary recomputation.

### 12. Encapsulate Side Effects in Services
All side effects (API calls, algorithmic computations, library integrations, storage, I/O) are isolated in service modules. Services are plain objects/functions, framework‑free, and receive dependencies via constructor injection (or parameters). They are called only by stores or orchestrators – never by components.

### 13. Isolate Third‑Party Libraries Behind Wrappers
Integrations with external libraries (UI toolkits, visualisation engines, editors, simulations) are encapsulated in dedicated services or wrapper components. The wrapper converts plain application data into the library’s expected format and converts library callbacks into application actions. No library‑specific types or calls leak into the rest of the application.

### 14. Keep Presentation Modules “Boring” and Devoid of Logic
Presentation components receive data via props or selectors and emit events via callbacks. They contain no data fetching, no asynchronous operations, no data transformation, no cross‑domain coordination. Ephemeral UI state (tooltip visibility, hover) may use local component state; anything shared or persisted moves to a state container.

### 15. Avoid Reactive Effects for State Synchronisation
Synchronising state changes across domains must never be handled by component‑level reactive effects (e.g., `useEffect`, `watch`, `onMount`). Such synchronisation must be performed explicitly by orchestrators at the point of the triggering action or via deliberate, top‑level subscriptions – never as an implicit consequence of rendering.

### 16. Refactor Incrementally, Keeping the System Always Working
Architectural improvements are applied in small, verifiable steps. After each step, the system remains fully functional. Big‑bang rewrites are avoided because they introduce high risk and loss of confidence. Incremental migration keeps the system operational at all times.

### 17. Use Static Typing Aggressively to Enforce Architecture
Every layer has explicit, strict types. Leverage a strong static type system (e.g., TypeScript, Rust, Haskell) to make illegal states unrepresentable. Type boundaries enforce dependency direction, prevent direct cross‑domain imports, and cause compile‑time failures when a feature is removed (e.g., only orchestrators that referenced it break). Typing is used as a design tool, not merely for documentation.