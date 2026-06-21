/** The stress threshold at which an entity forms a core memory and potentially promotes. */
export const STRESS_CORE_MEMORY_THRESHOLD = 100;

/** The maximum number of transient thoughts an entity can hold in MemoryComponent before culling. */
export const MAX_TRANSIENT_THOUGHTS = 10;

/** A facet value >= this is considered extreme (triggers auto-promotion). */
export const FACET_EXTREME_HIGH_THRESHOLD = 100;

/** A facet value <= this is considered extreme (triggers auto-promotion). */
export const FACET_EXTREME_LOW_THRESHOLD = 0;

/** A facet value >= this is considered dominant (visible in UI). */
export const FACET_DOMINANT_HIGH_THRESHOLD = 80;

/** A facet value <= this is considered dominant (visible in UI). */
export const FACET_DOMINANT_LOW_THRESHOLD = 20;

/** Base facet mutation applied during a core memory event. */
export const CORE_MEMORY_MUTATION_AMOUNT = 20;
