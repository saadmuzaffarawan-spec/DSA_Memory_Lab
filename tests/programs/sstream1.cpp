#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include <limits>
#include <iomanip>
using namespace std;

int main() {
  istringstream in("10 20 abc 3.5\nsecond line here\n7");
  int a, b; string w; double d;
  in >> a >> b >> w >> d;
  cout << a << "," << b << "," << w << "," << d << "\n";
  string rest;
  getline(in, rest);           // remainder of line 1 (empty)
  getline(in, rest);
  cout << "[" << rest << "]\n";
  int last = 0; in >> last;
  cout << last << " eof=" << in.eof() << "\n";

  ostringstream out;
  out << "x=" << 5 << ' ' << 2.5 << ' ' << true << '\n';
  out << setw(6) << setfill('*') << 42 << hex << ' ' << 255;
  cout << out.str() << "\n";

  stringstream ss;
  ss << 12 << ' ' << 34;
  int p, q; ss >> p >> q;
  cout << p + q << "\n";

  // split a csv line
  string line = "alpha,beta,gamma";
  stringstream cs(line);
  string tok; vector<string> parts;
  while (getline(cs, tok, ',')) parts.push_back(tok);
  cout << parts.size() << " " << parts[2] << "\n";

  // failed parse
  istringstream bad("hello");
  int n = -1; bad >> n;
  cout << bad.fail() << "\n";

  cout << numeric_limits<int>::max() << " " << numeric_limits<int>::min() << " " << numeric_limits<unsigned>::max() << " "
       << numeric_limits<long long>::max() << " " << numeric_limits<short>::min() << " "
       << numeric_limits<double>::max() << " " << numeric_limits<double>::epsilon() << " " << numeric_limits<float>::max() << "\n";
  int best = numeric_limits<int>::max();
  for (int v : {5, 3, 9}) if (v < best) best = v;
  cout << best << "\n";
  return 0;
}
