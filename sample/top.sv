// Top level for the example design. Open this file and use the status bar
// button (or SystemVerilog: Show RTL Hierarchy Graph) to see the graph.
module top #(
  parameter int DATA_WIDTH = 8,
  parameter int DEPTH      = 16
) (
  input  wire                  clk,
  input  wire                  rst_n,
  input  wire [DATA_WIDTH-1:0] din,
  output wire                  pop,
  output wire [DATA_WIDTH-1:0] dout,
  output wire [15:0]           status
);

  import counter_pkg::*;

  logic [DATA_WIDTH-1:0] push_data;
  logic                  push;
  logic                  full;
  logic                  empty;

  assign status = {empty, full, push, pop};

  // push_data is filled by the datapath; for the example a simple ramp is
  // enough to drive the FIFO.
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) push_data <= '0;
    else        push_data <= push_data + 1'b1;
  end

  assign push = !full && (push_data[0] ^ 1'b1);
  assign pop  = !empty;

  fifo #(
    .WIDTH (DATA_WIDTH),
    .DEPTH (DEPTH)
  ) u_fifo (
    .clk   (clk),
    .rst_n (rst_n),
    .push  (push),
    .pop   (pop),
    .din   (push_data),
    .full  (full),
    .empty (empty),
    .dout  (dout)
  );

endmodule