// Shared types and constants for the example design.
package counter_pkg;

  // Address width for a depth-N memory, expressed in SystemVerilog terms.
  localparam int AW = $clog2(16);

  typedef enum logic [1:0] {
    IDLE = 2'b00,
    LOAD = 2'b01,
    STORE = 2'b10
  } state_t;

  // Packed register file entry.
  typedef struct packed {
    logic       valid;
    logic [7:0] data;
  } entry_t;

endpackage : counter_pkg