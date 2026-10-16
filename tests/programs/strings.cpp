#include <iostream>
#include <string>
using namespace std;
int main(){
  string a = "hello", b(" world"); a += b; a.push_back('!');
  cout << a << " " << a.size() << " " << a.capacity() << "\n";
  string c(20, 'x'); cout << c << " " << c.capacity() << "\n";
  c.append("yyyy"); cout << c.size() << " " << c.capacity() << "\n";
  string d = a.substr(6, 5); cout << d << "|" << a.find("wor") << "|" << a.find('z') << (a.find('z')==string::npos) << "\n";
  a.insert(5, ","); a.erase(0,1); a.replace(0, 4, "J"); cout << a << "\n";
  cout << (a < b) << (a == "J, world!") << a.compare("J") << "\n";
  string e = to_string(42) + "-" + to_string(3.5); cout << e << " " << stoi("123abc") << " " << stod("2.5e1") << "\n";
  try { string("abc").at(10); } catch (const out_of_range& ex) { cout << ex.what() << "\n"; }
  try { stoi("zz"); } catch (const invalid_argument& ex) { cout << ex.what() << "\n"; }
  string f; for (int i = 0; i < 40; i++) { f += 'a'; if (i==14||i==15||i==16||i==30||i==31||i==32) cout << f.size() << ":" << f.capacity() << " "; } cout << "\n";
  cout << sizeof(string) << "\n";
  string g = std::move(f); cout << g.size() << f.size() << "\n";
  for (char ch : d) cout << (char)(ch - 32); cout << "\n";
  string line; getline(cin, line); cout << "[" << line << "]"; string w; cin >> w; cout << w << "\n";
}
