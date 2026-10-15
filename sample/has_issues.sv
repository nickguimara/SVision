// Deliberately imperfect RTL, used to demonstrate the diagnostics.
// Each rule below is off by design -- do not copy this file.
module top #(
  parameter int WIDTH = 32
) (
  input  wire               clk,
  input  wire               rst_n,
  input  wire [WIDTH-1:0]   din,
  output wire [WIDTH-1:0]   dout
);

  import counter_pkg::*;

  logic [15:0] narrow;      // too narrow for the value assigned to it
  logic [31:0] mixed;
  logic [7:0]  value;
  logic        flag;
  logic [31:0] undeclared_use;

  fifo #(
    .WIDTH(8),
    .DEPTH(16)
  ) u_fifo (
    .clk   (clk),
    .rst_n (rst_n),
    .push  (flag),
    .pop   (flag),
    .din   (value),
    .full  (flag),
    .empty (),
    .dout  (value)
  );

  // 1. width-mismatch: a 16-bit target fed a 32-bit expression.
  assign narrow = din + din;

  // 2. sequential-blocking: `=` inside always_ff should be `<=`.
  always_ff @(posedge clk) begin
    mixed = din;
  end

  // 3. latch-inference: `value` is only assigned when `flag` is set.
  always_comb begin
    if (flag) begin
      value = din[7:0];
    end
  end

  // 4. implicit-sensitivity: `flag` is read but not listed.
  always @(clk) begin
    dout = flag ? din : '0;
  end

  // 5. unknown-identifier: `undeclared_use` is declared, but this one is not.
  assign dout = never_declared;

endmodule